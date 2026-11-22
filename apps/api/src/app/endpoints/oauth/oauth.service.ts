import {
  getMcpResourceIdentifier,
  getScopesSupportedByMcp
} from '@ghostfolio/api/helper/mcp-oauth.helper';
import {
  MAX_REDIRECT_URIS,
  isValidRedirectUri,
  matchesRegisteredRedirectUri
} from '@ghostfolio/api/helper/oauth-redirect-uri.helper';
import {
  generateOAuthAccessToken,
  generateOAuthAuthorizationCode,
  generateOAuthRefreshToken,
  hashOAuthSecret,
  isCodeVerifierValid
} from '@ghostfolio/api/helper/oauth-token.helper';
import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import {
  SCOPES_OF_WRITE_ACCESS,
  getScopesOfAccess
} from '@ghostfolio/common/scopes';

import { Injectable, Logger } from '@nestjs/common';
import { OAuthClient, OAuthToken } from '@prisma/client';
import ms from 'ms';
import { randomUUID } from 'node:crypto';

import { OAuthException } from './oauth.exception';
import {
  OAuthAuthorizationParams,
  OAuthAuthorizationRequest,
  OAuthConsentDescription,
  OAuthGrant,
  OAuthTokenResponse
} from './oauth.interfaces';

export const OAUTH_ACCESS_TOKEN_TTL = ms('1 hour');
export const OAUTH_AUTHORIZATION_CODE_TTL = ms('60 seconds');
export const OAUTH_REFRESH_TOKEN_TTL = ms('30 days');

const MAX_CLIENTS = 10_000;
const MAX_CLIENT_NAME_LENGTH = 100;
const MAX_PARAMETER_LENGTH = 2048;

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  public constructor(
    private readonly configurationService: ConfigurationService,
    private readonly prismaService: PrismaService
  ) {}

  /**
   * Gives the parameters of the request of an authorization from the raw
   * input. A value which is not a string counts as absent.
   */
  public static getAuthorizationParams(
    raw: Record<string, unknown> = {}
  ): OAuthAuthorizationParams {
    const get = (key: string) => {
      const value = raw[key];

      return typeof value === 'string' && value.length <= MAX_PARAMETER_LENGTH
        ? value
        : undefined;
    };

    return {
      clientId: get('client_id'),
      codeChallenge: get('code_challenge'),
      codeChallengeMethod: get('code_challenge_method'),
      redirectUri: get('redirect_uri'),
      resource: get('resource'),
      responseType: get('response_type'),
      scope: get('scope'),
      state: get('state')
    };
  }

  /**
   * Gives the redirect URL which denies the request of an authorization
   */
  public getDeniedRedirectUrl({
    redirectUri,
    state
  }: Pick<OAuthAuthorizationRequest, 'redirectUri' | 'state'>) {
    return this.getRedirectUrl({
      redirectUri,
      state,
      parameters: {
        error: 'access_denied',
        error_description: 'The user denied the request'
      }
    });
  }

  /**
   * Gives the redirect URL which reports the error to the client. It exists
   * only if the redirect URI was verified.
   */
  public getErrorRedirectUrl(exception: OAuthException) {
    if (!exception.redirect) {
      return undefined;
    }

    return this.getRedirectUrl({
      parameters: {
        error: exception.error,
        error_description: exception.errorDescription
      },
      redirectUri: exception.redirect.redirectUri,
      state: exception.redirect.state
    });
  }

  public async describeAuthorizationRequest(
    params: OAuthAuthorizationParams
  ): Promise<OAuthConsentDescription> {
    const request = await this.validateAuthorizationRequest(params);

    return {
      clientName: request.clientName,
      readOnlyScopes: request.scopes.filter((scope) => {
        return !SCOPES_OF_WRITE_ACCESS.includes(scope as never);
      }),
      redirectHost: new URL(request.redirectUri).host,
      scopes: request.scopes
    };
  }

  /**
   * Gives the redirect URL with the code, after the user consented
   */
  public async grantAuthorization({
    params,
    readOnly,
    userId
  }: {
    params: OAuthAuthorizationParams;
    readOnly: boolean;
    userId: string;
  }) {
    const request = await this.validateAuthorizationRequest(params);

    const scopes = getScopesOfAccess({
      scopes: readOnly
        ? request.scopes.filter((scope) => {
            return !SCOPES_OF_WRITE_ACCESS.includes(scope as never);
          })
        : request.scopes,
      type: 'MCP'
    });

    if (!scopes.length) {
      throw new OAuthException(
        'invalid_scope',
        'No scope is left to grant',
        400,
        { redirectUri: request.redirectUri, state: request.state }
      );
    }

    await this.purgeExpired();

    const code = generateOAuthAuthorizationCode();

    await this.prismaService.oAuthAuthorizationCode.create({
      data: {
        scopes,
        userId,
        clientId: request.clientId,
        codeChallenge: request.codeChallenge,
        codeHash: hashOAuthSecret(code),
        expiresAt: new Date(Date.now() + OAUTH_AUTHORIZATION_CODE_TTL),
        redirectUri: request.redirectUri,
        resource: request.resource
      }
    });

    this.logger.log(
      `User ${userId} granted ${scopes.length} scopes to the OAuth client ${request.clientId}`
    );

    return this.getRedirectUrl({
      redirectUri: request.redirectUri,
      state: request.state,
      parameters: { code }
    });
  }

  public async denyAuthorization(params: OAuthAuthorizationParams) {
    const request = await this.validateAuthorizationRequest(params);

    return this.getDeniedRedirectUrl(request);
  }

  public async exchangeAuthorizationCode({
    clientId,
    code,
    codeVerifier,
    redirectUri,
    resource
  }: {
    clientId?: string;
    code?: string;
    codeVerifier?: string;
    redirectUri?: string;
    resource?: string;
  }): Promise<OAuthTokenResponse> {
    if (!clientId || !code || !codeVerifier || !redirectUri) {
      throw new OAuthException(
        'invalid_request',
        'client_id, code, code_verifier and redirect_uri are required'
      );
    }

    const authorizationCode =
      await this.prismaService.oAuthAuthorizationCode.findUnique({
        where: { codeHash: hashOAuthSecret(code) }
      });

    if (!authorizationCode) {
      throw new OAuthException('invalid_grant', 'The code is invalid');
    }

    if (authorizationCode.usedAt) {
      // A replayed code: the tokens which it issued are no longer trusted
      await this.revokeFamily(authorizationCode.id);

      throw new OAuthException('invalid_grant', 'The code was already used');
    }

    if (
      authorizationCode.clientId !== clientId ||
      authorizationCode.redirectUri !== redirectUri ||
      authorizationCode.expiresAt.getTime() <= Date.now() ||
      !isCodeVerifierValid({
        codeChallenge: authorizationCode.codeChallenge,
        codeVerifier
      })
    ) {
      throw new OAuthException(
        'invalid_grant',
        'The code is expired or does not match the request'
      );
    }

    if (resource !== undefined && resource !== authorizationCode.resource) {
      throw new OAuthException(
        'invalid_target',
        'The resource does not match the authorization'
      );
    }

    // The update is atomic, hence only one of two parallel requests wins
    const { count } =
      await this.prismaService.oAuthAuthorizationCode.updateMany({
        data: { usedAt: new Date() },
        where: { id: authorizationCode.id, usedAt: null }
      });

    if (count !== 1) {
      await this.revokeFamily(authorizationCode.id);

      throw new OAuthException('invalid_grant', 'The code was already used');
    }

    return this.issueTokens({
      clientId,
      // The tokens of one authorization share the family of its code
      familyId: authorizationCode.id,
      resource: authorizationCode.resource,
      scopes: authorizationCode.scopes,
      userId: authorizationCode.userId
    });
  }

  public async getGrants(userId: string): Promise<OAuthGrant[]> {
    const tokens = await this.prismaService.oAuthToken.findMany({
      include: { client: true },
      orderBy: { createdAt: 'desc' },
      where: {
        userId,
        expiresAt: { gt: new Date() },
        revokedAt: null,
        type: 'REFRESH',
        usedAt: null
      }
    });

    return tokens.map(({ client, createdAt, familyId, scopes }) => {
      return { createdAt, scopes, clientName: client.clientName, id: familyId };
    });
  }

  public async refreshTokens({
    clientId,
    refreshToken,
    resource,
    scope
  }: {
    clientId?: string;
    refreshToken?: string;
    resource?: string;
    scope?: string;
  }): Promise<OAuthTokenResponse> {
    if (!clientId || !refreshToken) {
      throw new OAuthException(
        'invalid_request',
        'client_id and refresh_token are required'
      );
    }

    const token = await this.prismaService.oAuthToken.findUnique({
      where: { hash: hashOAuthSecret(refreshToken) }
    });

    if (!token || token.type !== 'REFRESH' || token.clientId !== clientId) {
      throw new OAuthException('invalid_grant', 'The refresh token is invalid');
    }

    if (token.usedAt) {
      // A rotated token was presented again, hence it may have been stolen
      await this.revokeFamily(token.familyId);

      throw new OAuthException(
        'invalid_grant',
        'The refresh token was already used'
      );
    }

    if (token.revokedAt || token.expiresAt.getTime() <= Date.now()) {
      throw new OAuthException(
        'invalid_grant',
        'The refresh token is expired or revoked'
      );
    }

    if (resource !== undefined && resource !== token.resource) {
      throw new OAuthException(
        'invalid_target',
        'The resource does not match the authorization'
      );
    }

    let scopes = token.scopes;

    if (scope) {
      const requested = scope.split(' ').filter(Boolean);

      if (!requested.every((value) => token.scopes.includes(value))) {
        throw new OAuthException(
          'invalid_scope',
          'The scope exceeds the granted scope'
        );
      }

      scopes = requested;
    }

    const { count } = await this.prismaService.oAuthToken.updateMany({
      data: { usedAt: new Date() },
      where: { id: token.id, revokedAt: null, usedAt: null }
    });

    if (count !== 1) {
      await this.revokeFamily(token.familyId);

      throw new OAuthException(
        'invalid_grant',
        'The refresh token was already used'
      );
    }

    return this.issueTokens({
      clientId,
      scopes,
      familyId: token.familyId,
      resource: token.resource,
      userId: token.userId
    });
  }

  /**
   * Registers a client dynamically (RFC 7591). The clients are public, hence
   * the proof of possession is PKCE and no secret is issued.
   */
  public async registerClient(body: Record<string, unknown> = {}) {
    const redirectUris = body.redirect_uris;

    if (
      !Array.isArray(redirectUris) ||
      !redirectUris.length ||
      redirectUris.length > MAX_REDIRECT_URIS ||
      !redirectUris.every((redirectUri) => {
        return isValidRedirectUri(redirectUri);
      })
    ) {
      throw new OAuthException(
        'invalid_redirect_uri',
        `redirect_uris needs 1 to ${MAX_REDIRECT_URIS} absolute URIs, each with the scheme https or with the scheme http on a loopback address, and without a fragment`
      );
    }

    if (
      body.token_endpoint_auth_method !== undefined &&
      body.token_endpoint_auth_method !== 'none'
    ) {
      throw new OAuthException(
        'invalid_client_metadata',
        'Only the token_endpoint_auth_method none is supported'
      );
    }

    if (
      body.grant_types !== undefined &&
      (!Array.isArray(body.grant_types) ||
        !body.grant_types.every((grantType) => {
          return ['authorization_code', 'refresh_token'].includes(grantType);
        }))
    ) {
      throw new OAuthException(
        'invalid_client_metadata',
        'The supported grant_types are authorization_code and refresh_token'
      );
    }

    if (
      body.response_types !== undefined &&
      (!Array.isArray(body.response_types) ||
        !body.response_types.every((responseType) => {
          return responseType === 'code';
        }))
    ) {
      throw new OAuthException(
        'invalid_client_metadata',
        'The only supported response_types is code'
      );
    }

    if (
      body.client_name !== undefined &&
      typeof body.client_name !== 'string'
    ) {
      throw new OAuthException(
        'invalid_client_metadata',
        'client_name has to be a string'
      );
    }

    if ((await this.prismaService.oAuthClient.count()) >= MAX_CLIENTS) {
      throw new OAuthException(
        'invalid_client_metadata',
        'The registration is not available',
        503
      );
    }

    const clientName =
      ((body.client_name as string | undefined) ?? '')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim()
        .slice(0, MAX_CLIENT_NAME_LENGTH) || 'MCP client';

    const client = await this.prismaService.oAuthClient.create({
      data: {
        clientName,
        id: randomUUID(),
        redirectUris: [...new Set(redirectUris as string[])]
      }
    });

    return {
      client_id: client.id,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      client_name: client.clientName,
      grant_types: ['authorization_code', 'refresh_token'],
      redirect_uris: client.redirectUris,
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    };
  }

  /**
   * Gives the access token as the record which it stands for, but only if it
   * is neither expired nor revoked and if it was issued for this resource
   */
  public async resolveAccessToken(accessToken: string) {
    const token = await this.prismaService.oAuthToken.findUnique({
      where: { hash: hashOAuthSecret(accessToken) }
    });

    if (
      !token ||
      token.type !== 'ACCESS' ||
      token.revokedAt ||
      token.expiresAt.getTime() <= Date.now() ||
      token.resource !== getMcpResourceIdentifier(this.configurationService)
    ) {
      return undefined;
    }

    if (
      !token.lastUsedAt ||
      Date.now() - token.lastUsedAt.getTime() > ms('1 minute')
    ) {
      await this.prismaService.oAuthToken.update({
        data: { lastUsedAt: new Date() },
        where: { id: token.id }
      });
    }

    return token;
  }

  /**
   * Revokes the authorization of the token (RFC 7009), i.e. the whole family
   * of the access token and the refresh token. An unknown token is no error.
   */
  public async revokeToken({
    clientId,
    token
  }: {
    clientId?: string;
    token?: string;
  }) {
    if (!token) {
      throw new OAuthException('invalid_request', 'token is required');
    }

    const record = await this.prismaService.oAuthToken.findUnique({
      where: { hash: hashOAuthSecret(token) }
    });

    if (record && (!clientId || record.clientId === clientId)) {
      await this.revokeFamily(record.familyId);
    }
  }

  public async revokeGrant({
    id,
    userId
  }: {
    id: string;
    userId: string;
  }): Promise<boolean> {
    const { count } = await this.prismaService.oAuthToken.updateMany({
      data: { revokedAt: new Date() },
      where: { userId, familyId: id, revokedAt: null }
    });

    return count > 0;
  }

  /**
   * Validates the request of an authorization. An error names the redirect URI
   * only after the client and the redirect URI were verified, because an
   * unverified URI must not receive a redirect (open redirect).
   */
  public async validateAuthorizationRequest(
    params: OAuthAuthorizationParams
  ): Promise<OAuthAuthorizationRequest> {
    if (!params.clientId || !params.redirectUri) {
      throw new OAuthException(
        'invalid_request',
        'client_id and redirect_uri are required'
      );
    }

    const client = await this.getClient(params.clientId);

    if (
      !client ||
      !matchesRegisteredRedirectUri({
        redirectUri: params.redirectUri,
        registeredRedirectUris: client.redirectUris
      })
    ) {
      throw new OAuthException(
        'invalid_request',
        'The client or the redirect_uri is not registered'
      );
    }

    const redirect = { redirectUri: params.redirectUri, state: params.state };

    if (params.responseType !== 'code') {
      throw new OAuthException(
        'unsupported_response_type',
        'Only response_type=code is supported',
        400,
        redirect
      );
    }

    if (!params.codeChallenge || params.codeChallengeMethod !== 'S256') {
      throw new OAuthException(
        'invalid_request',
        'PKCE with code_challenge_method=S256 is required',
        400,
        redirect
      );
    }

    // A SHA-256 hash as base64url has 43 characters
    if (!/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge)) {
      throw new OAuthException(
        'invalid_request',
        'The code_challenge is not a SHA-256 hash',
        400,
        redirect
      );
    }

    if (
      params.resource !== getMcpResourceIdentifier(this.configurationService)
    ) {
      throw new OAuthException(
        'invalid_target',
        'The resource has to be the URL of the MCP server',
        400,
        redirect
      );
    }

    const supported = getScopesSupportedByMcp();
    let scopes = supported;

    if (params.scope?.trim()) {
      const requested = params.scope.split(' ').filter(Boolean);

      scopes = supported.filter((scope) => {
        return requested.includes(scope);
      });

      if (!scopes.length) {
        throw new OAuthException(
          'invalid_scope',
          'None of the requested scopes is supported',
          400,
          redirect
        );
      }
    }

    return {
      scopes,
      clientId: client.id,
      clientName: client.clientName,
      codeChallenge: params.codeChallenge,
      redirectUri: params.redirectUri,
      resource: params.resource,
      state: params.state
    };
  }

  private async getClient(clientId: string): Promise<OAuthClient | null> {
    // The identifier of a client is a UUID, which the database would reject
    // with an error for any other value
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        clientId
      )
    ) {
      return null;
    }

    return this.prismaService.oAuthClient.findUnique({
      where: { id: clientId }
    });
  }

  private getRedirectUrl({
    parameters,
    redirectUri,
    state
  }: {
    parameters: Record<string, string>;
    redirectUri: string;
    state?: string;
  }) {
    const url = new URL(redirectUri);

    for (const [key, value] of Object.entries(parameters)) {
      url.searchParams.set(key, value);
    }

    if (state !== undefined) {
      url.searchParams.set('state', state);
    }

    // RFC 9207: the client can verify the issuer of the response
    url.searchParams.set(
      'iss',
      this.configurationService.get('ROOT_URL').replace(/\/+$/, '')
    );

    return url.toString();
  }

  private async issueTokens({
    clientId,
    familyId,
    resource,
    scopes,
    userId
  }: Pick<OAuthToken, 'clientId' | 'familyId' | 'resource' | 'userId'> & {
    scopes: string[];
  }): Promise<OAuthTokenResponse> {
    const accessToken = generateOAuthAccessToken();
    const refreshToken = generateOAuthRefreshToken();
    const now = Date.now();

    await this.prismaService.oAuthToken.createMany({
      data: [
        {
          clientId,
          familyId,
          resource,
          scopes,
          userId,
          expiresAt: new Date(now + OAUTH_ACCESS_TOKEN_TTL),
          hash: hashOAuthSecret(accessToken),
          type: 'ACCESS'
        },
        {
          clientId,
          familyId,
          resource,
          scopes,
          userId,
          expiresAt: new Date(now + OAUTH_REFRESH_TOKEN_TTL),
          hash: hashOAuthSecret(refreshToken),
          type: 'REFRESH'
        }
      ]
    });

    return {
      access_token: accessToken,
      expires_in: OAUTH_ACCESS_TOKEN_TTL / 1000,
      refresh_token: refreshToken,
      scope: scopes.join(' '),
      token_type: 'Bearer'
    };
  }

  /**
   * Deletes the codes and the tokens which expired a day ago
   */
  private async purgeExpired() {
    const threshold = new Date(Date.now() - ms('1 day'));

    try {
      await this.prismaService.oAuthAuthorizationCode.deleteMany({
        where: { expiresAt: { lt: threshold } }
      });
      await this.prismaService.oAuthToken.deleteMany({
        where: { expiresAt: { lt: threshold } }
      });
    } catch (error) {
      this.logger.warn(error);
    }
  }

  private async revokeFamily(familyId: string) {
    await this.prismaService.oAuthToken.updateMany({
      data: { revokedAt: new Date() },
      where: { familyId, revokedAt: null }
    });
  }
}
