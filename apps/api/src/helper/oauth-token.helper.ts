import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const OAUTH_ACCESS_TOKEN_PREFIX = 'gfoat_';
export const OAUTH_AUTHORIZATION_CODE_PREFIX = 'gfoac_';
export const OAUTH_REFRESH_TOKEN_PREFIX = 'gfort_';

/**
 * Gives a random secret of 32 bytes as base64url with a prefix, which secret
 * scanners can detect. The database stores only its hash.
 */
function generateSecret(prefix: string) {
  return `${prefix}${randomBytes(32).toString('base64url')}`;
}

export function generateOAuthAccessToken() {
  return generateSecret(OAUTH_ACCESS_TOKEN_PREFIX);
}

export function generateOAuthAuthorizationCode() {
  return generateSecret(OAUTH_AUTHORIZATION_CODE_PREFIX);
}

export function generateOAuthRefreshToken() {
  return generateSecret(OAUTH_REFRESH_TOKEN_PREFIX);
}

/**
 * Gives the SHA-256 hash of the secret as hex. A secret has a high entropy,
 * hence a fast hash suffices and the lookup by the hash stays possible.
 */
export function hashOAuthSecret(secret: string) {
  return createHash('sha256').update(secret).digest('hex');
}

/**
 * Tells if the bearer token is an access token which the authorization server
 * issued, in contrast to the token of an access of the user
 */
export function isOAuthAccessToken(token?: string) {
  return !!token?.startsWith(OAUTH_ACCESS_TOKEN_PREFIX);
}

/**
 * Tells if the code verifier matches the code challenge of the method S256
 * (RFC 7636), which is the only method which the server supports
 */
export function isCodeVerifierValid({
  codeChallenge,
  codeVerifier
}: {
  codeChallenge: string;
  codeVerifier: string;
}) {
  // RFC 7636: 43 to 128 characters of the unreserved set
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(codeVerifier)) {
    return false;
  }

  const expected = createHash('sha256').update(codeVerifier).digest();
  const actual = Buffer.from(codeChallenge, 'base64url');

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
