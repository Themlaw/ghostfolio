import { createHash, randomBytes } from 'node:crypto';

export const MCP_TOKEN_PREFIX = 'gfmcp_';

/**
 * Gives a new token of an access of the Model Context Protocol (MCP): 32
 * random bytes as base64url with a prefix, which secret scanners can detect.
 * The token is shown once. The database stores only its hash.
 */
export function generateMcpToken() {
  return `${MCP_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/**
 * Gives the SHA-256 hash of the token as hex. The token has a high entropy,
 * hence a fast hash suffices and the lookup by the hash stays possible.
 */
export function hashMcpToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
