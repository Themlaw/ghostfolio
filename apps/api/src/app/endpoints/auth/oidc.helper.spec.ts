import {
  getOidcDiscoveryUrl,
  getOidcThirdPartyId,
  isOidcUserAllowed
} from './oidc.helper';

describe('getOidcDiscoveryUrl', () => {
  it.each([
    [
      'https://auth.example.com',
      'https://auth.example.com/.well-known/openid-configuration'
    ],
    [
      'https://auth.example.com/',
      'https://auth.example.com/.well-known/openid-configuration'
    ],
    [
      'https://auth.example.com/application/o/ghostfolio/',
      'https://auth.example.com/application/o/ghostfolio/.well-known/openid-configuration'
    ]
  ])('creates the discovery URL for %s', (issuer, expected) => {
    expect(getOidcDiscoveryUrl(issuer)).toBe(expected);
  });
});

describe('isOidcUserAllowed', () => {
  it('allows everyone without allowlist', () => {
    expect(isOidcUserAllowed({ claims: { sub: 'x' } })).toBe(true);
  });

  it('matches the subject', () => {
    expect(
      isOidcUserAllowed({ allowedSubjects: 'a, b', claims: { sub: 'b' } })
    ).toBe(true);
    expect(
      isOidcUserAllowed({ allowedSubjects: 'a, b', claims: { sub: 'c' } })
    ).toBe(false);
  });

  it('requires a verified email', () => {
    const claims = { email: 'Me@Example.com', sub: 'x' };

    expect(
      isOidcUserAllowed({
        allowedEmails: 'me@example.com',
        claims: { ...claims, email_verified: true }
      })
    ).toBe(true);
    expect(isOidcUserAllowed({ allowedEmails: 'me@example.com', claims })).toBe(
      false
    );
  });
});

describe('getOidcThirdPartyId', () => {
  it('combines issuer and subject', () => {
    expect(
      getOidcThirdPartyId({ issuer: 'https://idp.example.com/', subject: 's' })
    ).toBe('https://idp.example.com|s');
  });
});
