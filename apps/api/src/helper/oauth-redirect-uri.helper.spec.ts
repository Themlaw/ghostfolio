import {
  isValidRedirectUri,
  matchesRegisteredRedirectUri
} from './oauth-redirect-uri.helper';

describe('oauth-redirect-uri.helper', () => {
  it.each([
    'https://claude.ai/api/mcp/auth_callback',
    'http://localhost:6274/callback',
    'http://127.0.0.1/callback',
    'http://[::1]:8080/callback'
  ])('Accepts %s', (redirectUri) => {
    expect(isValidRedirectUri(redirectUri)).toBe(true);
  });

  it.each([
    'http://example.com/callback',
    'https://example.com/callback#a',
    'https://u:p@example.com/callback',
    'myapp://callback',
    'javascript:alert(1)',
    '/relative',
    '',
    undefined,
    42
  ])('Rejects %s', (redirectUri) => {
    expect(isValidRedirectUri(redirectUri)).toBe(false);
  });

  it('Compares exactly, except for the port of a loopback address', () => {
    const registeredRedirectUris = [
      'https://claude.ai/callback',
      'http://localhost:1000/cb'
    ];

    expect(
      matchesRegisteredRedirectUri({
        registeredRedirectUris,
        redirectUri: 'https://claude.ai/callback'
      })
    ).toBe(true);
    expect(
      matchesRegisteredRedirectUri({
        registeredRedirectUris,
        redirectUri: 'https://claude.ai:444/callback'
      })
    ).toBe(false);
    expect(
      matchesRegisteredRedirectUri({
        registeredRedirectUris,
        redirectUri: 'http://localhost:2000/cb'
      })
    ).toBe(true);
    expect(
      matchesRegisteredRedirectUri({
        registeredRedirectUris,
        redirectUri: 'http://localhost:2000/other'
      })
    ).toBe(false);
  });
});
