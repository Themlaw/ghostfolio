export interface OAuthAuthorizationParams {
  clientId?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  redirectUri?: string;
  resource?: string;
  responseType?: string;
  scope?: string;
  state?: string;
}

export interface OAuthAuthorizationRequest {
  clientId: string;
  clientName: string;
  codeChallenge: string;
  redirectUri: string;
  resource: string;
  scopes: string[];
  state?: string;
}

export interface OAuthConsentDescription {
  clientName: string;
  readOnlyScopes: string[];
  redirectHost: string;
  scopes: string[];
}

export interface OAuthTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
  token_type: 'Bearer';
}

export interface OAuthGrant {
  clientName: string;
  createdAt: Date;
  id: string;
  scopes: string[];
}
