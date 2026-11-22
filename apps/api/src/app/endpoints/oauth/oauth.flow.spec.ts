import { createMcpAuthorizationMiddleware } from '@ghostfolio/api/middlewares/mcp-authorization.middleware';
import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { ImpersonationService } from '@ghostfolio/api/services/impersonation/impersonation.service';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import { UserService } from '@ghostfolio/api/services/user/user.service';
import { SCOPES_OF_WRITE_ACCESS } from '@ghostfolio/common/scopes';

import { createHash, randomBytes } from 'node:crypto';

import { OAuthController } from './oauth.controller';
import { OAuthException } from './oauth.exception';
import { OAuthService } from './oauth.service';

type Row = Record<string, any>;

/**
 * A minimal in-memory replacement of the tables of the authorization server
 */
function createTable(unique: string[] = []) {
  const rows: Row[] = [];

  const matches = (row: Row, where: Row = {}) => {
    return Object.entries(where).every(([key, condition]) => {
      if (
        condition &&
        typeof condition === 'object' &&
        !(condition instanceof Date)
      ) {
        if ('gt' in condition) {
          return row[key] > condition.gt;
        }

        if ('lt' in condition) {
          return row[key] < condition.lt;
        }
      }

      return (row[key] ?? null) === condition;
    });
  };

  const create = (data: Row) => {
    const row = {
      createdAt: new Date(),
      id: crypto.randomUUID(),
      lastUsedAt: null,
      revokedAt: null,
      usedAt: null,
      ...data
    };

    for (const key of unique) {
      if (rows.some((other) => other[key] === row[key])) {
        throw new Error(`Unique constraint on ${key}`);
      }
    }

    rows.push(row);

    return row;
  };

  return {
    rows,
    count: async () => rows.length,
    create: async ({ data }: { data: Row }) => create(data),
    createMany: async ({ data }: { data: Row[] }) => {
      data.forEach(create);

      return { count: data.length };
    },
    deleteMany: async ({ where }: { where: Row }) => {
      const doomed = rows.filter((row) => matches(row, where));
      doomed.forEach((row) => rows.splice(rows.indexOf(row), 1));

      return { count: doomed.length };
    },
    findMany: async ({ where }: { where: Row }) => {
      return rows.filter((row) => matches(row, where));
    },
    findUnique: async ({ where }: { where: Row }) => {
      return rows.find((row) => matches(row, where)) ?? null;
    },
    update: async ({ data, where }: { data: Row; where: Row }) => {
      const row = rows.find((other) => matches(other, where));

      Object.assign(row as Row, data);

      return row;
    },
    updateMany: async ({ data, where }: { data: Row; where: Row }) => {
      const found = rows.filter((row) => matches(row, where));
      found.forEach((row) => Object.assign(row, data));

      return { count: found.length };
    }
  };
}

function createPkce() {
  const verifier = randomBytes(32).toString('base64url');

  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url')
  };
}

describe('OAuth 2.1 authorization server of the MCP', () => {
  const resource = 'https://ghostfol.io/mcp';
  const redirectUri = 'https://claude.ai/api/mcp/auth_callback';
  const userId = 'user-1';

  let controller: OAuthController;
  let prismaService: PrismaService;
  let service: OAuthService;
  let tables: ReturnType<typeof createTables>;

  function createTables() {
    return {
      client: createTable(),
      code: createTable(['codeHash']),
      token: createTable(['hash'])
    };
  }

  async function register(redirectUris = [redirectUri]) {
    const response = await controller.register(
      { client_name: 'Claude', redirect_uris: redirectUris },
      { setHeader: jest.fn() } as any
    );

    return response.client_id;
  }

  async function authorize({
    clientId,
    overrides = {},
    readOnly = true
  }: {
    clientId: string;
    overrides?: Record<string, unknown>;
    readOnly?: boolean;
  }) {
    const pkce = createPkce();
    const parameters = {
      client_id: clientId,
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
      redirect_uri: redirectUri,
      resource,
      response_type: 'code',
      state: 'xyz',
      ...overrides
    };

    const { redirectUrl } = await controller.consent(
      { ...parameters, approve: true, readOnly },
      { setHeader: jest.fn() } as any
    );
    const url = new URL(redirectUrl);

    // The consent reports a rejected request as a redirect to the client
    if (url.searchParams.has('error')) {
      throw new OAuthException(
        url.searchParams.get('error') as string,
        url.searchParams.get('error_description') as string
      );
    }

    return { parameters, pkce, url, code: url.searchParams.get('code') };
  }

  const response = { setHeader: jest.fn() } as any;

  function token(body: Record<string, unknown>) {
    return controller.token(body, response);
  }

  async function expectError(promise: Promise<unknown>, error: string) {
    await expect(promise).rejects.toMatchObject({ error });
    await expect(promise).rejects.toBeInstanceOf(OAuthException);
  }

  beforeEach(() => {
    tables = createTables();

    const findMany = tables.token.findMany;

    prismaService = {
      oAuthAuthorizationCode: tables.code,
      oAuthClient: tables.client,
      oAuthToken: {
        ...tables.token,
        findMany: async (args: { where: Record<string, unknown> }) => {
          return (await findMany(args)).map((row) => {
            return {
              ...row,
              client: tables.client.rows.find(({ id }) => {
                return id === row.clientId;
              })
            };
          });
        }
      }
    } as unknown as PrismaService;

    const configurationService = {
      get: jest.fn((key: string) => {
        return {
          ENABLE_FEATURE_MCP: true,
          ENABLE_FEATURE_MCP_OAUTH: true,
          ROOT_URL: 'https://ghostfol.io'
        }[key];
      })
    } as unknown as ConfigurationService;

    service = new OAuthService(configurationService, prismaService);
    controller = new OAuthController(configurationService, service, {
      user: { id: userId }
    } as any);
  });

  it('runs the complete flow: register, authorize, consent, token, MCP call, refresh, rotation, reuse and revocation', async () => {
    // register
    const clientId = await register();

    // authorize: the user is sent to the page of consent
    const pkce = createPkce();
    const query = {
      client_id: clientId,
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
      redirect_uri: redirectUri,
      resource,
      response_type: 'code',
      scope: 'portfolio:read report:create',
      state: 'xyz'
    };
    const redirect = jest.fn();

    await controller.authorize(query, {
      redirect,
      setHeader: jest.fn()
    } as any);

    const consentUrl = new URL(redirect.mock.calls[0][1]);

    expect(consentUrl.origin + consentUrl.pathname).toBe(
      'https://ghostfol.io/en/oauth/consent'
    );
    expect(consentUrl.searchParams.get('state')).toBe('xyz');

    // consent: the page describes the request, then the user approves
    const description = await controller.describeAuthorization(query, response);

    expect(description).toMatchObject({
      clientName: 'Claude',
      readOnlyScopes: ['portfolio:read'],
      redirectHost: 'claude.ai',
      scopes: ['portfolio:read', 'report:create']
    });

    const { redirectUrl } = await controller.consent(
      { ...query, approve: true, readOnly: false },
      response
    );
    const callback = new URL(redirectUrl);

    expect(callback.origin + callback.pathname).toBe(redirectUri);
    expect(callback.searchParams.get('state')).toBe('xyz');
    expect(callback.searchParams.get('iss')).toBe('https://ghostfol.io');

    const code = callback.searchParams.get('code') as string;

    // the database stores only the hash of the code
    expect(tables.code.rows[0].codeHash).not.toBe(code);

    // token
    const tokens = await token({
      client_id: clientId,
      code,
      code_verifier: pkce.verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      resource
    });

    expect(tokens).toMatchObject({
      expires_in: 3600,
      scope: 'portfolio:read report:create',
      token_type: 'Bearer'
    });
    expect(tokens.access_token.startsWith('gfoat_')).toBe(true);
    expect(JSON.stringify(tables.token.rows)).not.toContain(
      tokens.access_token
    );
    expect(JSON.stringify(tables.token.rows)).not.toContain(
      tokens.refresh_token
    );

    // the MCP endpoint accepts the access token
    const call = async (accessToken: string) => {
      const next = jest.fn();
      const status = jest.fn().mockReturnThis();
      const json = jest.fn();
      const impersonationService = {
        resolve: jest.fn().mockResolvedValue({ isActive: false }),
        resolveOAuthGrant: jest.fn().mockResolvedValue({
          isActive: true,
          scopes: ['portfolio:read'],
          userId
        })
      } as unknown as ImpersonationService;
      const request: any = {
        headers: { authorization: `Bearer ${accessToken}` }
      };

      await createMcpAuthorizationMiddleware({
        impersonationService,
        configurationService: (service as any).configurationService,
        oauthService: service,
        userService: {} as UserService
      })(request, { json, setHeader: jest.fn(), status } as any, next);

      return { impersonationService, next, request, status };
    };

    const accepted = await call(tokens.access_token);

    expect(accepted.next).toHaveBeenCalled();
    expect(
      accepted.impersonationService.resolveOAuthGrant
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: ['portfolio:read', 'report:create'],
        userId
      })
    );

    // refresh: rotation
    const refreshed = await token({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token
    });

    expect(refreshed.refresh_token).not.toBe(tokens.refresh_token);
    expect((await call(refreshed.access_token)).next).toHaveBeenCalled();

    // reuse of the rotated token: the family is revoked, the new tokens too
    await expectError(
      token({
        client_id: clientId,
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token
      }),
      'invalid_grant'
    );
    await expectError(
      token({
        client_id: clientId,
        grant_type: 'refresh_token',
        refresh_token: refreshed.refresh_token
      }),
      'invalid_grant'
    );

    const revokedCall = await call(refreshed.access_token);

    expect(revokedCall.next).not.toHaveBeenCalled();
    expect(revokedCall.status).toHaveBeenCalledWith(401);

    // a new authorization, then revocation (RFC 7009)
    const second = await authorize({ clientId });
    const secondTokens = await token({
      client_id: clientId,
      code: second.code,
      code_verifier: second.pkce.verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    });

    expect(await controller.getGrants()).toMatchObject({
      grants: [{ clientName: 'Claude' }]
    });

    await controller.revoke({ token: secondTokens.refresh_token }, response);

    expect((await call(secondTokens.access_token)).next).not.toHaveBeenCalled();
    await expectError(
      token({
        client_id: clientId,
        grant_type: 'refresh_token',
        refresh_token: secondTokens.refresh_token
      }),
      'invalid_grant'
    );
    expect((await controller.getGrants()).grants).toEqual([]);

    // an unknown token is no error
    await expect(
      controller.revoke({ token: 'gfort_unknown' }, response)
    ).resolves.toEqual({});
  });

  it('grants read-only scopes by default and by choice', async () => {
    const clientId = await register();
    const { code, pkce } = await authorize({ clientId });
    const tokens = await token({
      client_id: clientId,
      code,
      code_verifier: pkce.verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    });

    const granted = tokens.scope.split(' ');

    expect(granted.length).toBeGreaterThan(0);
    expect(
      granted.some((scope) => SCOPES_OF_WRITE_ACCESS.includes(scope as never))
    ).toBe(false);
    expect(granted).not.toContain('report:create');
  });

  it('refuses the authorization without PKCE or with the method plain', async () => {
    const clientId = await register();

    await expectError(
      authorize({ clientId, overrides: { code_challenge: undefined } }),
      'invalid_request'
    );
    await expectError(
      authorize({
        clientId,
        overrides: { code_challenge_method: 'plain' }
      }),
      'invalid_request'
    );
    await expectError(
      authorize({ clientId, overrides: { code_challenge_method: undefined } }),
      'invalid_request'
    );
  });

  it('answers a request with an error to the registered redirect URI, together with the state', async () => {
    const clientId = await register();
    const redirect = jest.fn();

    await controller.authorize(
      {
        client_id: clientId,
        code_challenge_method: 'plain',
        redirect_uri: redirectUri,
        response_type: 'code',
        state: 'abc'
      },
      { redirect, setHeader: jest.fn() } as any
    );

    const url = new URL(redirect.mock.calls[0][1]);

    expect(url.searchParams.get('error')).toBe('invalid_request');
    expect(url.searchParams.get('state')).toBe('abc');
  });

  it('refuses a wrong resource', async () => {
    const clientId = await register();

    await expectError(
      authorize({
        clientId,
        overrides: { resource: 'https://ghostfol.io/other' }
      }),
      'invalid_target'
    );
    await expectError(
      authorize({ clientId, overrides: { resource: undefined } }),
      'invalid_target'
    );
  });

  it('refuses a redirect URI which is not registered, without a redirect', async () => {
    const clientId = await register();
    const redirect = jest.fn();

    await expect(
      controller.authorize(
        {
          client_id: clientId,
          code_challenge_method: 'S256',
          redirect_uri: 'https://evil.example/callback',
          response_type: 'code'
        },
        { redirect, setHeader: jest.fn() } as any
      )
    ).rejects.toMatchObject({ error: 'invalid_request', redirect: undefined });
    expect(redirect).not.toHaveBeenCalled();

    await expectError(
      authorize({
        clientId,
        overrides: { redirect_uri: 'https://claude.ai/api/mcp/auth_callback/x' }
      }),
      'invalid_request'
    );
  });

  it('refuses a wrong code verifier, a different redirect URI and a different resource at the token endpoint', async () => {
    const clientId = await register();
    const { code, pkce } = await authorize({ clientId });
    const base = {
      client_id: clientId,
      code,
      code_verifier: pkce.verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    };

    await expectError(
      token({ ...base, code_verifier: createPkce().verifier }),
      'invalid_grant'
    );
    await expectError(
      token({ ...base, redirect_uri: 'https://claude.ai/other' }),
      'invalid_grant'
    );
    await expectError(
      token({ ...base, resource: 'https://ghostfol.io/other' }),
      'invalid_target'
    );
    await expectError(
      token({ ...base, client_id: await register() }),
      'invalid_grant'
    );
    await expectError(
      token({ ...base, code_verifier: 'short' }),
      'invalid_grant'
    );

    // the valid request still works afterwards
    await expect(token(base)).resolves.toHaveProperty('access_token');
  });

  it('refuses a reused code and revokes the tokens which it issued', async () => {
    const clientId = await register();
    const { code, pkce } = await authorize({ clientId });
    const body = {
      client_id: clientId,
      code,
      code_verifier: pkce.verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    };
    const tokens = await token(body);

    await expectError(token(body), 'invalid_grant');
    expect(
      await service.resolveAccessToken(tokens.access_token)
    ).toBeUndefined();
  });

  it('refuses an expired code, an expired access token and an expired refresh token', async () => {
    const clientId = await register();
    const first = await authorize({ clientId });

    tables.code.rows[0].expiresAt = new Date(Date.now() - 1000);

    await expectError(
      token({
        client_id: clientId,
        code: first.code,
        code_verifier: first.pkce.verifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri
      }),
      'invalid_grant'
    );

    const second = await authorize({ clientId });
    const tokens = await token({
      client_id: clientId,
      code: second.code,
      code_verifier: second.pkce.verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    });

    expect(await service.resolveAccessToken(tokens.access_token)).toBeDefined();

    tables.token.rows.forEach((row) => {
      row.expiresAt = new Date(Date.now() - 1000);
    });

    expect(
      await service.resolveAccessToken(tokens.access_token)
    ).toBeUndefined();
    await expectError(
      token({
        client_id: clientId,
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token
      }),
      'invalid_grant'
    );
  });

  it('refuses an access token which was issued for another resource and the refresh token as an access token', async () => {
    const clientId = await register();
    const { code, pkce } = await authorize({ clientId });
    const tokens = await token({
      client_id: clientId,
      code,
      code_verifier: pkce.verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    });

    expect(
      await service.resolveAccessToken(tokens.refresh_token)
    ).toBeUndefined();

    tables.token.rows.forEach((row) => {
      row.resource = 'https://other.example/mcp';
    });

    expect(
      await service.resolveAccessToken(tokens.access_token)
    ).toBeUndefined();
  });

  it('refuses a refresh with a scope beyond the granted one', async () => {
    const clientId = await register();
    const { code, pkce } = await authorize({ clientId });
    const tokens = await token({
      client_id: clientId,
      code,
      code_verifier: pkce.verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    });

    await expectError(
      token({
        client_id: clientId,
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        scope: 'report:create'
      }),
      'invalid_scope'
    );
  });

  it('validates the dynamic client registration', async () => {
    const invalid = [
      undefined,
      [],
      ['http://example.com/callback'],
      ['https://example.com/callback#fragment'],
      ['javascript:alert(1)'],
      ['https://user:pass@example.com/callback'],
      ['not a url'],
      Array.from({ length: 11 }, (_, index) => {
        return `https://example.com/${index}`;
      })
    ];

    for (const redirect_uris of invalid) {
      await expectError(
        controller.register({ redirect_uris }, response),
        'invalid_redirect_uri'
      );
    }

    await expectError(
      controller.register(
        {
          redirect_uris: [redirectUri],
          token_endpoint_auth_method: 'client_secret_basic'
        },
        response
      ),
      'invalid_client_metadata'
    );

    await expect(
      controller.register(
        {
          redirect_uris: [redirectUri, 'http://127.0.0.1:33418/callback'],
          token_endpoint_auth_method: 'none'
        },
        response
      )
    ).resolves.toMatchObject({
      grant_types: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_method: 'none'
    });
  });

  it('accepts any port on a registered loopback redirect URI', async () => {
    const clientId = await register(['http://127.0.0.1:1234/callback']);
    const { url } = await authorize({
      clientId,
      overrides: { redirect_uri: 'http://127.0.0.1:55555/callback' }
    });

    expect(url.origin).toBe('http://127.0.0.1:55555');
    await expectError(
      authorize({
        clientId,
        overrides: { redirect_uri: 'http://127.0.0.1:55555/other' }
      }),
      'invalid_request'
    );
  });

  it('answers a denial with access_denied and the state', async () => {
    const clientId = await register();
    const pkce = createPkce();
    const { redirectUrl } = await controller.consent(
      {
        approve: false,
        client_id: clientId,
        code_challenge: pkce.challenge,
        code_challenge_method: 'S256',
        redirect_uri: redirectUri,
        resource,
        response_type: 'code',
        state: 'xyz'
      },
      response
    );
    const url = new URL(redirectUrl);

    expect(url.searchParams.get('error')).toBe('access_denied');
    expect(url.searchParams.get('state')).toBe('xyz');
    expect(tables.code.rows).toHaveLength(0);
  });

  it('refuses an unsupported grant type', async () => {
    await expectError(
      token({ grant_type: 'password' }),
      'unsupported_grant_type'
    );
  });

  it('lets the user revoke only an own authorization', async () => {
    const clientId = await register();
    const { code, pkce } = await authorize({ clientId });

    await token({
      client_id: clientId,
      code,
      code_verifier: pkce.verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    });

    const [{ id }] = (await controller.getGrants()).grants;
    const other = new OAuthController(
      (service as any).configurationService,
      service,
      { user: { id: 'user-2' } } as any
    );

    await expect(other.revokeGrant(id)).rejects.toMatchObject({ status: 404 });
    await expect(controller.revokeGrant(id)).resolves.toBeUndefined();
    expect((await controller.getGrants()).grants).toEqual([]);
  });
});
