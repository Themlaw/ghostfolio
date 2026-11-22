import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';

import * as client from 'openid-client';

import { AuthService } from './auth.service';
import { OidcService } from './oidc.service';

jest.mock(
  '@ghostfolio/api/services/configuration/configuration.service',
  () => ({
    ConfigurationService: class {}
  })
);
jest.mock('./auth.service', () => ({ AuthService: class {} }));
jest.mock('openid-client', () => {
  let counter = 0;

  class Configuration {
    public constructor(
      private readonly server: Record<string, unknown>,
      public readonly clientId: string
    ) {}

    public serverMetadata() {
      return this.server;
    }
  }

  return {
    ClientSecretBasic: jest.fn(),
    ClientSecretPost: jest.fn(),
    Configuration,
    allowInsecureRequests: jest.fn(),
    authorizationCodeGrant: jest.fn(),
    buildAuthorizationUrl: jest.fn(
      (_config: unknown, parameters: Record<string, string>) => {
        return new URL(
          `https://idp.example.com/authorize?${new URLSearchParams(parameters)}`
        );
      }
    ),
    calculatePKCECodeChallenge: jest.fn(async (verifier: string) => {
      return `challenge-${verifier}`;
    }),
    discovery: jest.fn(async () => {
      return new Configuration(
        {
          authorization_endpoint: 'https://idp.example.com/authorize',
          issuer: 'https://idp.example.com',
          jwks_uri: 'https://idp.example.com/jwks',
          token_endpoint: 'https://idp.example.com/token'
        },
        'client-id'
      );
    }),
    fetchUserInfo: jest.fn(),
    randomNonce: jest.fn(() => `nonce-${++counter}`),
    randomPKCECodeVerifier: jest.fn(() => `verifier-${++counter}`),
    randomState: jest.fn(() => `state-${++counter}`)
  };
});

describe('OidcService', () => {
  const grant = client.authorizationCodeGrant as jest.Mock;
  const fetchUserInfo = client.fetchUserInfo as jest.Mock;

  let authService: { validateOAuthLogin: jest.Mock };
  let environment: Record<string, unknown>;
  let oidcService: OidcService;

  function mockTokens(claims: Record<string, unknown>) {
    grant.mockResolvedValue({
      access_token: 'access-token',
      claims: () => claims
    });
  }

  async function start() {
    const { flowId, url } = await oidcService.createAuthorizationRequest();

    return { flowId, parameters: new URL(url).searchParams };
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();

    environment = {
      OIDC_ALLOWED_EMAILS: '',
      OIDC_ALLOWED_SUBJECTS: '',
      OIDC_AUTHORIZATION_URL: '',
      OIDC_CALLBACK_URL: '',
      OIDC_CLIENT_ID: 'client-id',
      OIDC_CLIENT_SECRET: 'client-secret',
      OIDC_ISSUER: 'https://idp.example.com',
      OIDC_SCOPE: ['openid', 'email'],
      OIDC_TOKEN_URL: '',
      OIDC_USER_INFO_URL: '',
      ROOT_URL: 'https://folio.example.com'
    };

    authService = { validateOAuthLogin: jest.fn().mockResolvedValue('jwt') };

    oidcService = new OidcService(
      authService as unknown as AuthService,
      {
        get: (key: string) => environment[key]
      } as unknown as ConfigurationService
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('createAuthorizationRequest', () => {
    it('uses PKCE S256, state and nonce', async () => {
      const { parameters } = await start();

      expect(parameters.get('code_challenge_method')).toBe('S256');
      expect(parameters.get('code_challenge')).toMatch(/^challenge-verifier-/);
      expect(parameters.get('state')).toMatch(/^state-/);
      expect(parameters.get('nonce')).toMatch(/^nonce-/);
      expect(parameters.get('response_type')).toBe('code');
      expect(parameters.get('redirect_uri')).toBe(
        'https://folio.example.com/api/auth/oidc/callback'
      );
      expect(parameters.get('scope')).toBe('openid email');
    });

    it('binds each flow to a distinct random id', async () => {
      const first = await start();
      const second = await start();

      expect(first.flowId).not.toBe(second.flowId);
      expect(first.flowId.length).toBeGreaterThanOrEqual(43);
    });
  });

  describe('handleCallback', () => {
    it('verifies state, nonce and the PKCE verifier of the flow', async () => {
      const { flowId, parameters } = await start();

      mockTokens({ sub: 'user-1' });

      await expect(
        oidcService.handleCallback({
          flowId,
          search: `?code=abc&state=${parameters.get('state')}`
        })
      ).resolves.toBe('jwt');

      const [, currentUrl, checks] = grant.mock.calls[0];

      expect(currentUrl.origin + currentUrl.pathname).toBe(
        'https://folio.example.com/api/auth/oidc/callback'
      );
      expect(currentUrl.search).toBe(
        `?code=abc&state=${parameters.get('state')}`
      );
      expect(checks.expectedState).toBe(parameters.get('state'));
      expect(checks.expectedNonce).toBe(parameters.get('nonce'));
      expect(checks.idTokenExpected).toBe(true);
      expect(`challenge-${checks.pkceCodeVerifier}`).toBe(
        parameters.get('code_challenge')
      );
    });

    it('links the account to issuer and subject and migrates the legacy id', async () => {
      const { flowId } = await start();

      mockTokens({ sub: 'user-1' });

      await oidcService.handleCallback({ flowId, search: '?code=abc' });

      expect(authService.validateOAuthLogin).toHaveBeenCalledWith({
        legacyThirdPartyId: 'user-1',
        provider: 'OIDC',
        thirdPartyId: 'https://idp.example.com|user-1'
      });
    });

    it('rejects a missing flow (no cookie)', async () => {
      await start();

      await expect(
        oidcService.handleCallback({ search: '?code=abc&state=x' })
      ).rejects.toThrow('Invalid or expired OIDC flow');

      expect(grant).not.toHaveBeenCalled();
    });

    it('rejects an unknown flow id', async () => {
      await expect(
        oidcService.handleCallback({ flowId: 'forged', search: '?code=abc' })
      ).rejects.toThrow('Invalid or expired OIDC flow');
    });

    it('uses a flow only once', async () => {
      const { flowId } = await start();

      mockTokens({ sub: 'user-1' });

      await oidcService.handleCallback({ flowId, search: '?code=abc' });

      await expect(
        oidcService.handleCallback({ flowId, search: '?code=abc' })
      ).rejects.toThrow('Invalid or expired OIDC flow');
    });

    it('rejects an expired flow (10 minutes)', async () => {
      const { flowId } = await start();

      jest.advanceTimersByTime(10 * 60 * 1000 + 1);

      await expect(
        oidcService.handleCallback({ flowId, search: '?code=abc' })
      ).rejects.toThrow('Invalid or expired OIDC flow');
    });

    it('propagates a failed verification of the provider response', async () => {
      const { flowId } = await start();

      grant.mockRejectedValue(new Error('unexpected JWT "nonce" claim value'));

      await expect(
        oidcService.handleCallback({ flowId, search: '?code=abc' })
      ).rejects.toThrow('nonce');

      expect(authService.validateOAuthLogin).not.toHaveBeenCalled();
    });

    describe('allowlist', () => {
      it('refuses a subject which is not allowed', async () => {
        environment.OIDC_ALLOWED_SUBJECTS = 'user-1, user-2';

        const { flowId } = await start();

        mockTokens({ sub: 'intruder' });

        await expect(
          oidcService.handleCallback({ flowId, search: '?code=abc' })
        ).rejects.toThrow('OIDC user is not allowed');

        expect(authService.validateOAuthLogin).not.toHaveBeenCalled();
      });

      it('accepts a subject which is allowed', async () => {
        environment.OIDC_ALLOWED_SUBJECTS = 'user-1,user-2';

        const { flowId } = await start();

        mockTokens({ sub: 'user-2' });

        await expect(
          oidcService.handleCallback({ flowId, search: '?code=abc' })
        ).resolves.toBe('jwt');
      });

      it('refuses an allowed email which is not verified', async () => {
        environment.OIDC_ALLOWED_EMAILS = 'me@example.com';

        const { flowId } = await start();

        mockTokens({
          email: 'me@example.com',
          email_verified: false,
          sub: 'user-1'
        });

        await expect(
          oidcService.handleCallback({ flowId, search: '?code=abc' })
        ).rejects.toThrow('OIDC user is not allowed');
      });

      it('accepts an allowed and verified email, read from userinfo if needed', async () => {
        environment.OIDC_ALLOWED_EMAILS = 'Me@Example.com';

        const { flowId } = await start();

        mockTokens({ sub: 'user-1' });
        fetchUserInfo.mockResolvedValue({
          email: 'me@example.com',
          email_verified: true,
          sub: 'user-1'
        });

        await expect(
          oidcService.handleCallback({ flowId, search: '?code=abc' })
        ).resolves.toBe('jwt');

        expect(fetchUserInfo).toHaveBeenCalledWith(
          expect.anything(),
          'access-token',
          'user-1'
        );
      });
    });
  });

  describe('exchange code', () => {
    it('gives the token once', () => {
      const code = oidcService.createExchangeCode('jwt');

      expect(oidcService.exchangeCode(code)).toBe('jwt');
      expect(oidcService.exchangeCode(code)).toBeUndefined();
    });

    it('expires after 60 seconds', () => {
      const code = oidcService.createExchangeCode('jwt');

      jest.advanceTimersByTime(60 * 1000 + 1);

      expect(oidcService.exchangeCode(code)).toBeUndefined();
    });

    it('is still valid within 60 seconds', () => {
      const code = oidcService.createExchangeCode('jwt');

      jest.advanceTimersByTime(59 * 1000);

      expect(oidcService.exchangeCode(code)).toBe('jwt');
    });

    it('refuses unknown and missing codes', () => {
      expect(oidcService.exchangeCode('unknown')).toBeUndefined();
      expect(oidcService.exchangeCode(undefined)).toBeUndefined();
    });
  });
});
