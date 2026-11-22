import { createHash } from 'node:crypto';

import {
  generateOAuthAccessToken,
  generateOAuthRefreshToken,
  hashOAuthSecret,
  isCodeVerifierValid,
  isOAuthAccessToken
} from './oauth-token.helper';

describe('oauth-token.helper', () => {
  it('Generates prefixed tokens', () => {
    expect(generateOAuthAccessToken()).toMatch(/^gfoat_[A-Za-z0-9_-]{43}$/);
    expect(generateOAuthRefreshToken()).toMatch(/^gfort_[A-Za-z0-9_-]{43}$/);
    expect(isOAuthAccessToken(generateOAuthAccessToken())).toBe(true);
    expect(isOAuthAccessToken('gfmcp_abc')).toBe(false);
  });

  it('Hashes as SHA-256 in hex', () => {
    expect(hashOAuthSecret('abc')).toBe(
      createHash('sha256').update('abc').digest('hex')
    );
  });

  it('Verifies the code verifier against the challenge of the method S256', () => {
    const codeVerifier = 'a'.repeat(43);
    const codeChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    expect(isCodeVerifierValid({ codeChallenge, codeVerifier })).toBe(true);
    expect(
      isCodeVerifierValid({ codeChallenge, codeVerifier: 'b'.repeat(43) })
    ).toBe(false);
    // the plain method would send the verifier as the challenge
    expect(
      isCodeVerifierValid({ codeChallenge: codeVerifier, codeVerifier })
    ).toBe(false);
    expect(isCodeVerifierValid({ codeChallenge, codeVerifier: 'short' })).toBe(
      false
    );
  });
});
