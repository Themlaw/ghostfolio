import { HttpException } from '@nestjs/common';
import { StatusCodes } from 'http-status-codes';

/**
 * An error in the format of RFC 6749 (section 5.2). The redirect URI is set if
 * the request of an authorization named a registered one, hence the error may
 * be passed to the client as a redirect instead of being shown to the user.
 */
export class OAuthException extends HttpException {
  public constructor(
    public readonly error: string,
    public readonly errorDescription: string,
    status: number = StatusCodes.BAD_REQUEST,
    public readonly redirect?: { redirectUri: string; state?: string }
  ) {
    super({ error, error_description: errorDescription }, status);
  }
}
