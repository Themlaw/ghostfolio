const LOOPBACK_HOSTNAMES = ['127.0.0.1', '[::1]', 'localhost'];

export const MAX_REDIRECT_URIS = 10;
const MAX_REDIRECT_URI_LENGTH = 2048;

/**
 * Tells if the URI is a valid redirect URI of a client: absolute, with the
 * scheme HTTPS or with the scheme HTTP on a loopback address (RFC 8252), and
 * without a fragment and without credentials (OAuth 2.1)
 */
export function isValidRedirectUri(redirectUri: unknown) {
  if (
    typeof redirectUri !== 'string' ||
    redirectUri.length > MAX_REDIRECT_URI_LENGTH
  ) {
    return false;
  }

  let url: URL;

  try {
    url = new URL(redirectUri);
  } catch {
    return false;
  }

  if (url.hash || redirectUri.includes('#') || url.username || url.password) {
    return false;
  }

  return (
    url.protocol === 'https:' ||
    (url.protocol === 'http:' && LOOPBACK_HOSTNAMES.includes(url.hostname))
  );
}

/**
 * Tells if the requested redirect URI is one of the registered URIs. The
 * comparison is exact, except for the port of a loopback address (RFC 8252,
 * section 7.3), which a native client picks at random.
 */
export function matchesRegisteredRedirectUri({
  redirectUri,
  registeredRedirectUris
}: {
  redirectUri: string;
  registeredRedirectUris: string[];
}) {
  if (registeredRedirectUris.includes(redirectUri)) {
    return true;
  }

  if (!isValidRedirectUri(redirectUri)) {
    return false;
  }

  const requested = new URL(redirectUri);

  if (
    requested.protocol !== 'http:' ||
    !LOOPBACK_HOSTNAMES.includes(requested.hostname)
  ) {
    return false;
  }

  return registeredRedirectUris.some((registeredRedirectUri) => {
    const registered = new URL(registeredRedirectUri);

    return (
      registered.protocol === 'http:' &&
      registered.hostname === requested.hostname &&
      registered.pathname === requested.pathname &&
      registered.search === requested.search
    );
  });
}
