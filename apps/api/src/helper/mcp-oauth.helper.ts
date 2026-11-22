import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { MCP_ENDPOINT } from '@ghostfolio/common/config';
import { getScopesOfAccess, scopes } from '@ghostfolio/common/scopes';

import {
  getOAuthProtectedResourceMetadataUrl,
  OAuthMetadata
} from '@modelcontextprotocol/server';

/**
 * Gives the metadata of the authorization server (RFC 8414). The protected
 * resource metadata (RFC 9728) names its issuer.
 */
export function getMcpAuthorizationServerMetadata(
  configurationService: ConfigurationService
): OAuthMetadata {
  const rootUrl = getMcpOAuthBaseUrl(configurationService);

  return {
    authorization_endpoint: `${rootUrl}/api/v1/oauth/authorize`,
    code_challenge_methods_supported: ['S256'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    issuer: rootUrl,
    registration_endpoint: `${rootUrl}/api/v1/oauth/register`,
    response_types_supported: ['code'],
    revocation_endpoint: `${rootUrl}/api/v1/oauth/revoke`,
    revocation_endpoint_auth_methods_supported: ['none'],
    scopes_supported: getScopesSupportedByMcp(),
    token_endpoint: `${rootUrl}/api/v1/oauth/token`,
    token_endpoint_auth_methods_supported: ['none']
  };
}

/**
 * Gives the root URL without a trailing slash. The issuer and the resource in
 * the metadata have to be identical to the URL which the client uses.
 */
export function getMcpOAuthBaseUrl(configurationService: ConfigurationService) {
  return configurationService.get('ROOT_URL').replace(/\/+$/, '');
}

/**
 * Gives the identifier of the protected resource (RFC 8707), which is the URL
 * of the server of the Model Context Protocol (MCP) and the audience of each
 * access token
 */
export function getMcpResourceIdentifier(
  configurationService: ConfigurationService
) {
  return `${getMcpOAuthBaseUrl(configurationService)}${MCP_ENDPOINT}`;
}

/**
 * Gives the scopes which an access token of the server of the Model Context
 * Protocol (MCP) can carry
 */
export function getScopesSupportedByMcp() {
  return getScopesOfAccess({ scopes: Object.values(scopes), type: 'MCP' });
}

/**
 * Gives the URL of the protected resource metadata (RFC 9728) which the
 * challenge of the authorization middleware names
 */
export function getMcpProtectedResourceMetadataUrl(
  configurationService: ConfigurationService
) {
  return getOAuthProtectedResourceMetadataUrl(
    getMcpResourceUrl(configurationService)
  );
}

/**
 * Gives the URL of the server of the Model Context Protocol (MCP), which is the
 * resource of the protected resource metadata (RFC 9728)
 */
export function getMcpResourceUrl(configurationService: ConfigurationService) {
  return new URL(getMcpResourceIdentifier(configurationService));
}

/**
 * Tells if the authorization with OAuth 2.1 is enabled. It depends on the
 * server of the Model Context Protocol (MCP) and on a valid issuer URL.
 */
export function isMcpOAuthEnabled(configurationService: ConfigurationService) {
  return (
    configurationService.get('ENABLE_FEATURE_MCP') &&
    configurationService.get('ENABLE_FEATURE_MCP_OAUTH') &&
    isValidMcpOAuthIssuerUrl(configurationService)
  );
}

/**
 * Tells if the root URL is valid as the issuer of the authorization server:
 * OAuth 2.1 requires HTTPS, except for localhost. This is the same rule as in
 * buildOAuthProtectedResourceMetadata() of @modelcontextprotocol/server, which
 * throws an error for any other issuer.
 */
export function isValidMcpOAuthIssuerUrl(
  configurationService: ConfigurationService
) {
  const { hostname, protocol } = new URL(
    getMcpOAuthBaseUrl(configurationService)
  );

  return (
    protocol === 'https:' ||
    hostname === '127.0.0.1' ||
    hostname === 'localhost'
  );
}
