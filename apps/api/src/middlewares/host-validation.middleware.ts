import { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

const LOOPBACK_HOSTS = ['::1', '127.0.0.1', 'localhost'];
const HEALTH_PATH_REGEX = /^\/api\/v1\/health(\/|$)/;

/**
 * Normalizes a host name or the value of a Host header: lower case, without
 * port, without square brackets of an IPv6 address and without trailing dot.
 * Returns an empty string if the value is not a valid host.
 */
export function normalizeHost(value: string | undefined) {
  if (!value) {
    return '';
  }

  try {
    const { hostname } = new URL(
      `http://${value.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')}`
    );

    return hostname
      .replace(/^\[|\]$/g, '')
      .replace(/\.$/, '')
      .toLowerCase();
  } catch {
    return '';
  }
}

export function getAllowedHosts({
  allowedHosts,
  rootUrl
}: {
  allowedHosts: string;
  rootUrl: string;
}) {
  return new Set(
    [new URL(rootUrl).hostname, ...allowedHosts.split(',')]
      .map((host) => {
        return normalizeHost(host);
      })
      .filter(Boolean)
  );
}

/**
 * Answers with the status 421 to each request whose Host header is not the
 * host of ROOT_URL or in ALLOWED_HOSTS. Only the Host header counts, never
 * X-Forwarded-Host, which a client could set. The loopback addresses are
 * accepted for the health routes only, for the health check of Docker.
 */
export function createHostValidationMiddleware({
  allowedHosts,
  rootUrl
}: {
  allowedHosts: string;
  rootUrl: string;
}) {
  const hosts = getAllowedHosts({ allowedHosts, rootUrl });

  return (request: Request, response: Response, next: NextFunction) => {
    const host = normalizeHost(request.headers.host);

    if (
      host &&
      (hosts.has(host) ||
        (LOOPBACK_HOSTS.includes(host) && HEALTH_PATH_REGEX.test(request.path)))
    ) {
      return next();
    }

    return response
      .status(StatusCodes.MISDIRECTED_REQUEST)
      .type('text/plain')
      .send('Misdirected Request');
  };
}
