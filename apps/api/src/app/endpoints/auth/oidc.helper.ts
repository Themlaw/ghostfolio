export interface OidcClaims {
  email?: unknown;
  email_verified?: unknown;
  sub?: string;
}

export function getOidcDiscoveryUrl(issuer: string) {
  // Remove trailing slashes
  return `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`;
}

/**
 * Builds the identifier which links an account to an identity. It contains
 * the issuer, as a subject is only unique per issuer
 */
export function getOidcThirdPartyId({
  issuer,
  subject
}: {
  issuer: string;
  subject: string;
}) {
  return `${issuer.replace(/\/+$/, '')}|${subject}`;
}

/**
 * Checks the identity against the allowlists. Without any allowlist, everyone
 * is allowed. With at least one, the subject has to be listed or the email has
 * to be listed and verified
 */
export function isOidcUserAllowed({
  allowedEmails = '',
  allowedSubjects = '',
  claims
}: {
  allowedEmails?: string;
  allowedSubjects?: string;
  claims: OidcClaims;
}) {
  const emails = parseOidcList(allowedEmails).map((email) => {
    return email.toLowerCase();
  });
  const subjects = parseOidcList(allowedSubjects);

  if (emails.length === 0 && subjects.length === 0) {
    return true;
  }

  if (claims.sub && subjects.includes(claims.sub)) {
    return true;
  }

  const isEmailVerified =
    claims.email_verified === true || claims.email_verified === 'true';

  return (
    isEmailVerified &&
    typeof claims.email === 'string' &&
    emails.includes(claims.email.trim().toLowerCase())
  );
}

export function parseOidcList(value = '') {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
