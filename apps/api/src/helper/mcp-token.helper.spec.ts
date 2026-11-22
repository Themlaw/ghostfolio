import {
  generateMcpToken,
  hashMcpToken,
  MCP_TOKEN_PREFIX
} from './mcp-token.helper';

describe('mcp-token.helper', () => {
  it('Generates a token with the prefix and 32 random bytes', () => {
    const token = generateMcpToken();

    expect(token.startsWith(MCP_TOKEN_PREFIX)).toBe(true);
    expect(token.slice(MCP_TOKEN_PREFIX.length)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('Generates a different token each time', () => {
    expect(generateMcpToken()).not.toEqual(generateMcpToken());
  });

  it('Hashes the token as SHA-256 in hex', () => {
    expect(hashMcpToken('abc')).toEqual(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('Does not contain the token in the hash', () => {
    const token = generateMcpToken();

    expect(hashMcpToken(token)).not.toContain(token);
    expect(hashMcpToken(token)).toEqual(hashMcpToken(token));
  });
});
