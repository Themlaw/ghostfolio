import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';

import { Injectable, Logger } from '@nestjs/common';
import { Provider } from '@prisma/client';
import ms from 'ms';
import * as client from 'openid-client';

import { AuthService } from './auth.service';
import { OidcFlow } from './interfaces/interfaces';
import { OidcOneTimeStore } from './oidc-one-time.store';
import { getOidcThirdPartyId, isOidcUserAllowed } from './oidc.helper';

export const OIDC_FLOW_COOKIE_NAME = 'gf_oidc_flow';
export const OIDC_FLOW_TTL = ms('10 minutes');
export const OIDC_EXCHANGE_CODE_TTL = ms('60 seconds');

@Injectable()
export class OidcService {
  private readonly exchangeCodes = new OidcOneTimeStore<string>(
    OIDC_EXCHANGE_CODE_TTL
  );
  private readonly flows = new OidcOneTimeStore<OidcFlow>(OIDC_FLOW_TTL);
  private readonly logger = new Logger(OidcService.name);

  private configuration?: Promise<client.Configuration>;

  public constructor(
    private readonly authService: AuthService,
    private readonly configurationService: ConfigurationService
  ) {}

  /**
   * Consumes the code which the callback has issued and gives the JWT
   */
  public exchangeCode(code?: string) {
    return this.exchangeCodes.consume(code);
  }

  /**
   * Issues a single-use code (valid for 60 seconds) in place of the JWT
   */
  public createExchangeCode(jwt: string) {
    return this.exchangeCodes.put(jwt);
  }

  public getCallbackUrl() {
    return (
      this.configurationService.get('OIDC_CALLBACK_URL') ||
      `${this.configurationService.get('ROOT_URL')}/api/auth/oidc/callback`
    );
  }

  /**
   * Starts the authorization code flow with PKCE (S256), state and nonce. The
   * returned flow id has to be bound to the browser via a cookie
   */
  public async createAuthorizationRequest() {
    const configuration = await this.getConfiguration();

    const codeVerifier = client.randomPKCECodeVerifier();
    const nonce = client.randomNonce();
    const state = client.randomState();

    const scopes = new Set<string>([
      'openid',
      ...(this.configurationService.get('OIDC_SCOPE') ?? [])
    ]);

    const url = client.buildAuthorizationUrl(configuration, {
      code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: 'S256',
      nonce,
      redirect_uri: this.getCallbackUrl(),
      response_type: 'code',
      scope: [...scopes].join(' '),
      state
    });

    const flowId = this.flows.put({ codeVerifier, nonce, state });

    return { flowId, url: url.href };
  }

  /**
   * Completes the flow: verifies state, nonce, PKCE and the id token
   * (signature, issuer, audience, expiry), applies the allowlists and returns
   * the JWT of the user
   */
  public async handleCallback({
    flowId,
    search
  }: {
    flowId?: string;
    search: string;
  }) {
    const flow = this.flows.consume(flowId);

    if (!flow) {
      throw new Error('Invalid or expired OIDC flow');
    }

    const configuration = await this.getConfiguration();

    // The redirect URI of the token request derives from the configured
    // callback URL, not from the Host header of the request
    const currentUrl = new URL(this.getCallbackUrl());
    currentUrl.search = search;

    const tokens = await client.authorizationCodeGrant(
      configuration,
      currentUrl,
      {
        expectedNonce: flow.nonce,
        expectedState: flow.state,
        idTokenExpected: true,
        pkceCodeVerifier: flow.codeVerifier
      }
    );

    const claims = tokens.claims();
    const subject = claims?.sub;

    if (!subject) {
      throw new Error('Missing subject identifier in OIDC response');
    }

    const allowedEmails = this.configurationService.get('OIDC_ALLOWED_EMAILS');
    const allowedSubjects = this.configurationService.get(
      'OIDC_ALLOWED_SUBJECTS'
    );

    let userClaims: Record<string, unknown> = claims;

    if (allowedEmails && claims.email === undefined) {
      // The id token may not carry the email, the userinfo endpoint does
      userClaims = await client.fetchUserInfo(
        configuration,
        tokens.access_token,
        subject
      );
    }

    if (
      !isOidcUserAllowed({
        allowedEmails,
        allowedSubjects,
        claims: {
          email: userClaims.email,
          email_verified: userClaims.email_verified,
          sub: subject
        }
      })
    ) {
      this.logger.warn(`OIDC login refused for subject ${subject}`);

      throw new Error('OIDC user is not allowed');
    }

    return this.authService.validateOAuthLogin({
      legacyThirdPartyId: subject,
      provider: Provider.OIDC,
      thirdPartyId: getOidcThirdPartyId({
        issuer: configuration.serverMetadata().issuer,
        subject
      })
    });
  }

  private getConfiguration() {
    if (!this.configuration) {
      this.configuration = this.discover().catch((error) => {
        // Retry on the next request
        this.configuration = undefined;

        throw error;
      });
    }

    return this.configuration;
  }

  private async discover() {
    const issuer = this.configurationService.get('OIDC_ISSUER');
    const clientId = this.configurationService.get('OIDC_CLIENT_ID');
    const clientSecret = this.configurationService.get('OIDC_CLIENT_SECRET');

    if (!clientId || !clientSecret || !issuer) {
      throw new Error('OIDC configuration incomplete');
    }

    const issuerUrl = new URL(issuer);

    // The discovery document provides the keys (jwks_uri) to verify the
    // signature of the id token
    const discovered = await client.discovery(
      issuerUrl,
      clientId,
      clientSecret,
      undefined,
      issuerUrl.protocol === 'http:'
        ? { execute: [client.allowInsecureRequests] }
        : undefined
    );

    const server = { ...discovered.serverMetadata() };

    const authorizationUrl = this.configurationService.get(
      'OIDC_AUTHORIZATION_URL'
    );
    const tokenUrl = this.configurationService.get('OIDC_TOKEN_URL');
    const userInfoUrl = this.configurationService.get('OIDC_USER_INFO_URL');

    // Manual URLs take priority over the discovered ones
    if (authorizationUrl) {
      server.authorization_endpoint = authorizationUrl;
    }

    if (tokenUrl) {
      server.token_endpoint = tokenUrl;
    }

    if (userInfoUrl) {
      server.userinfo_endpoint = userInfoUrl;
    }

    const methods = server.token_endpoint_auth_methods_supported;

    const configuration = new client.Configuration(
      server,
      clientId,
      clientSecret,
      methods &&
        !methods.includes('client_secret_post') &&
        methods.includes('client_secret_basic')
        ? client.ClientSecretBasic(clientSecret)
        : client.ClientSecretPost(clientSecret)
    );

    if (issuerUrl.protocol === 'http:') {
      client.allowInsecureRequests(configuration);
    }

    return configuration;
  }
}
