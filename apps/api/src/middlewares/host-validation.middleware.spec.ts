import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import {
  createHostValidationMiddleware,
  normalizeHost
} from './host-validation.middleware';

describe('createHostValidationMiddleware', () => {
  let next: jest.Mock;
  let response: Response;

  function run({
    allowedHosts = '',
    host,
    path = '/api/v1/info'
  }: {
    allowedHosts?: string;
    host?: string;
    path?: string;
  }) {
    createHostValidationMiddleware({
      allowedHosts,
      rootUrl: 'https://Ghostfolio.example.com'
    })({ headers: { host }, path } as unknown as Request, response, next);
  }

  beforeEach(() => {
    next = jest.fn();
    response = {
      send: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
      type: jest.fn().mockReturnThis()
    } as unknown as Response;
  });

  it('allows the host of ROOT_URL', () => {
    run({ host: 'ghostfolio.example.com' });

    expect(next).toHaveBeenCalled();
    expect(response.status).not.toHaveBeenCalled();
  });

  it('ignores the port and the case of the host name', () => {
    run({ host: 'GHOSTFOLIO.Example.com:8443' });

    expect(next).toHaveBeenCalled();
  });

  it('refuses another host with 421 and a minimal body', () => {
    run({ host: 'evil.example.org' });

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(
      StatusCodes.MISDIRECTED_REQUEST
    );
    expect(response.send).toHaveBeenCalledWith('Misdirected Request');
  });

  it('refuses a missing or malformed Host header', () => {
    run({ host: undefined });
    run({ host: 'a b/c' });

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledTimes(2);
  });

  it('refuses a host which only starts with an allowed host', () => {
    run({ host: 'ghostfolio.example.com.evil.org' });

    expect(next).not.toHaveBeenCalled();
  });

  it('allows the hosts of ALLOWED_HOSTS', () => {
    run({
      allowedHosts: ' a.example.com, B.example.com ',
      host: 'b.example.com'
    });
    run({
      allowedHosts: 'a.example.com,b.example.com',
      host: 'a.example.com:1'
    });

    expect(next).toHaveBeenCalledTimes(2);
  });

  it.each(['localhost:3333', '127.0.0.1:3333', '[::1]:3333'])(
    'allows %s for the health routes only',
    (host) => {
      run({ host, path: '/api/v1/health' });
      run({ host, path: '/api/v1/health/liveness' });

      expect(next).toHaveBeenCalledTimes(2);

      run({ host, path: '/api/v1/info' });
      run({ host, path: '/api/v1/healthz' });
      run({ host, path: '/mcp' });

      expect(next).toHaveBeenCalledTimes(2);
      expect(response.status).toHaveBeenCalledTimes(3);
    }
  );

  it('does not trust X-Forwarded-Host', () => {
    createHostValidationMiddleware({
      allowedHosts: '',
      rootUrl: 'https://ghostfolio.example.com'
    })(
      {
        headers: {
          host: 'evil.example.org',
          'x-forwarded-host': 'ghostfolio.example.com'
        },
        path: '/'
      } as unknown as Request,
      response,
      next
    );

    expect(next).not.toHaveBeenCalled();
  });
});

describe('normalizeHost', () => {
  it('normalizes host names', () => {
    expect(normalizeHost('Example.COM.:443')).toBe('example.com');
    expect(normalizeHost('[::1]:3333')).toBe('::1');
    expect(normalizeHost('https://a.example.com/path')).toBe('a.example.com');
    expect(normalizeHost('')).toBe('');
  });
});
