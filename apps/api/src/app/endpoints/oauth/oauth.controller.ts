import { CustomThrottlerGuard } from '@ghostfolio/api/guards/custom-throttler.guard';
import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { DEFAULT_LANGUAGE_CODE } from '@ghostfolio/common/config';
import { internalRoutes } from '@ghostfolio/common/routes/routes';
import type { RequestWithUser } from '@ghostfolio/common/types';

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import ms from 'ms';

import { McpOAuthFeatureGuard } from './mcp-oauth-feature.guard';
import { OAuthException } from './oauth.exception';
import {
  OAuthConsentDescription,
  OAuthGrant,
  OAuthTokenResponse
} from './oauth.interfaces';
import { OAuthService } from './oauth.service';

type Body_ = Record<string, unknown>;

const THROTTLE_REGISTER = { default: { limit: 10, ttl: ms('1 hour') } };
const THROTTLE_REQUEST = { default: { limit: 30, ttl: ms('1 minute') } };

/**
 * The authorization server of the Model Context Protocol (MCP): registration
 * of the clients (RFC 7591), authorization with PKCE, tokens and revocation
 * (RFC 7009). The authentication of the user happens in the client of
 * Ghostfolio, whose consent page calls the endpoints of the consent with the
 * JWT of the user.
 */
@Controller('oauth')
@UseGuards(McpOAuthFeatureGuard)
export class OAuthController {
  public constructor(
    private readonly configurationService: ConfigurationService,
    private readonly oauthService: OAuthService,
    @Inject(REQUEST) private readonly request: RequestWithUser
  ) {}

  @Get('authorize')
  @Throttle(THROTTLE_REQUEST)
  @UseGuards(CustomThrottlerGuard)
  public async authorize(
    @Query() query: Body_,
    @Res() response: Response
  ): Promise<void> {
    const params = OAuthService.getAuthorizationParams(query);

    try {
      // The validation shows an error to the user, if the client or the
      // redirect URI is unknown, and redirects to the client otherwise
      await this.oauthService.validateAuthorizationRequest(params);
    } catch (error) {
      if (error instanceof OAuthException) {
        const redirectUrl = this.oauthService.getErrorRedirectUrl(error);

        if (redirectUrl) {
          return response.redirect(StatusCodes.SEE_OTHER, redirectUrl);
        }
      }

      throw error;
    }

    // The client of Ghostfolio keeps the JWT in its storage, hence the user
    // has to sign in and to consent on a page of the client
    const url = new URL(
      `${this.configurationService
        .get('ROOT_URL')
        .replace(
          /\/+$/,
          ''
        )}/${DEFAULT_LANGUAGE_CODE}/${internalRoutes.oauthConsent.path}`
    );

    for (const [key, value] of Object.entries(query)) {
      if (typeof value === 'string') {
        url.searchParams.set(key, value);
      }
    }

    response.setHeader('Cache-Control', 'no-store');

    return response.redirect(StatusCodes.SEE_OTHER, url.toString());
  }

  @Get('authorize/consent')
  @Throttle(THROTTLE_REQUEST)
  @UseGuards(AuthGuard('jwt'), CustomThrottlerGuard)
  public async describeAuthorization(
    @Query() query: Body_,
    @Res({ passthrough: true }) response: Response
  ): Promise<OAuthConsentDescription> {
    response.setHeader('Cache-Control', 'no-store');

    return this.oauthService.describeAuthorizationRequest(
      OAuthService.getAuthorizationParams(query)
    );
  }

  @HttpCode(StatusCodes.OK)
  @Post('authorize/consent')
  @Throttle(THROTTLE_REQUEST)
  @UseGuards(AuthGuard('jwt'), CustomThrottlerGuard)
  public async consent(
    @Body() body: Body_,
    @Res({ passthrough: true }) response: Response
  ): Promise<{ redirectUrl: string }> {
    response.setHeader('Cache-Control', 'no-store');

    const params = OAuthService.getAuthorizationParams(body);

    try {
      if (body.approve === true) {
        return {
          redirectUrl: await this.oauthService.grantAuthorization({
            params,
            // Without an explicit choice, the authorization is read-only
            readOnly: body.readOnly !== false,
            userId: this.request.user.id
          })
        };
      }

      return { redirectUrl: await this.oauthService.denyAuthorization(params) };
    } catch (error) {
      if (error instanceof OAuthException) {
        const redirectUrl = this.oauthService.getErrorRedirectUrl(error);

        if (redirectUrl) {
          return { redirectUrl };
        }
      }

      throw error;
    }
  }

  @Get('grants')
  @UseGuards(AuthGuard('jwt'))
  public async getGrants(): Promise<{ grants: OAuthGrant[] }> {
    return { grants: await this.oauthService.getGrants(this.request.user.id) };
  }

  @Delete('grants/:id')
  @HttpCode(StatusCodes.NO_CONTENT)
  @UseGuards(AuthGuard('jwt'))
  public async revokeGrant(
    @Param('id', ParseUUIDPipe) id: string
  ): Promise<void> {
    const isRevoked = await this.oauthService.revokeGrant({
      id,
      userId: this.request.user.id
    });

    if (!isRevoked) {
      throw new NotFoundException();
    }
  }

  @HttpCode(StatusCodes.CREATED)
  @Post('register')
  @Throttle(THROTTLE_REGISTER)
  @UseGuards(CustomThrottlerGuard)
  public async register(
    @Body() body: Body_,
    @Res({ passthrough: true }) response: Response
  ) {
    response.setHeader('Cache-Control', 'no-store');

    return this.oauthService.registerClient(body);
  }

  @HttpCode(StatusCodes.OK)
  @Post('revoke')
  @Throttle(THROTTLE_REQUEST)
  @UseGuards(CustomThrottlerGuard)
  public async revoke(
    @Body() body: Body_,
    @Res({ passthrough: true }) response: Response
  ): Promise<Record<string, never>> {
    response.setHeader('Cache-Control', 'no-store');

    await this.oauthService.revokeToken({
      clientId: getString(body.client_id),
      token: getString(body.token)
    });

    return {};
  }

  @HttpCode(StatusCodes.OK)
  @Post('token')
  @Throttle(THROTTLE_REQUEST)
  @UseGuards(CustomThrottlerGuard)
  public async token(
    @Body() body: Body_,
    @Res({ passthrough: true }) response: Response
  ): Promise<OAuthTokenResponse> {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Pragma', 'no-cache');

    switch (body.grant_type) {
      case 'authorization_code':
        return this.oauthService.exchangeAuthorizationCode({
          clientId: getString(body.client_id),
          code: getString(body.code),
          codeVerifier: getString(body.code_verifier),
          redirectUri: getString(body.redirect_uri),
          resource: getString(body.resource)
        });
      case 'refresh_token':
        return this.oauthService.refreshTokens({
          clientId: getString(body.client_id),
          refreshToken: getString(body.refresh_token),
          resource: getString(body.resource),
          scope: getString(body.scope)
        });
      default:
        throw new OAuthException(
          'unsupported_grant_type',
          'The supported grant types are authorization_code and refresh_token'
        );
    }
  }
}

function getString(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}
