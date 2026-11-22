import { AllowDuringImpersonation } from '@ghostfolio/api/decorators/allow-during-impersonation.decorator';
import { CustomThrottlerGuard } from '@ghostfolio/api/guards/custom-throttler.guard';
import { HasPermissionGuard } from '@ghostfolio/api/guards/has-permission.guard';
import { OAuthCallbackGuard } from '@ghostfolio/api/guards/oauth-callback.guard';
import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { DEFAULT_LANGUAGE_CODE } from '@ghostfolio/common/config';
import { AuthDeviceDto } from '@ghostfolio/common/dtos';
import {
  AssertionCredentialJSON,
  AttestationCredentialJSON,
  OAuthResponse
} from '@ghostfolio/common/interfaces';

import {
  Body,
  Controller,
  Get,
  HttpException,
  Logger,
  Post,
  Req,
  Res,
  UseGuards,
  Version,
  VERSION_NEUTRAL
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON
} from '@simplewebauthn/server';
import { Request, Response } from 'express';
import { getReasonPhrase, StatusCodes } from 'http-status-codes';

import { AuthService } from './auth.service';
import { GenerateAuthenticationOptionsDto } from './generate-authentication-options.dto';
import {
  OIDC_FLOW_COOKIE_NAME,
  OIDC_FLOW_TTL,
  OidcService
} from './oidc.service';
import { WebAuthService } from './web-auth.service';

@AllowDuringImpersonation()
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  public constructor(
    private readonly authService: AuthService,
    private readonly configurationService: ConfigurationService,
    private readonly oidcService: OidcService,
    private readonly webAuthService: WebAuthService
  ) {}

  @Post('anonymous')
  @UseGuards(CustomThrottlerGuard)
  public async accessTokenLogin(
    @Body() body: { accessToken: string }
  ): Promise<OAuthResponse> {
    try {
      const authToken = await this.authService.validateAnonymousLogin(
        body.accessToken
      );
      return { authToken };
    } catch {
      throw new HttpException(
        getReasonPhrase(StatusCodes.FORBIDDEN),
        StatusCodes.FORBIDDEN
      );
    }
  }

  @Get('google')
  @UseGuards(AuthGuard('google'))
  public googleLogin() {
    // Initiates the Google OAuth2 login flow
  }

  @Get('google/callback')
  @UseGuards(OAuthCallbackGuard('google'))
  @Version(VERSION_NEUTRAL)
  public googleLoginCallback(
    @Req() request: Request,
    @Res() response: Response
  ) {
    const jwt: string = (request.user as any)?.jwt;

    if (jwt) {
      response.redirect(
        `${this.configurationService.get(
          'ROOT_URL'
        )}/${DEFAULT_LANGUAGE_CODE}/auth/${jwt}`
      );
    } else {
      response.redirect(
        `${this.configurationService.get(
          'ROOT_URL'
        )}/${DEFAULT_LANGUAGE_CODE}/auth`
      );
    }
  }

  @Get('oidc')
  @Version(VERSION_NEUTRAL)
  public async oidcLogin(@Res() response: Response) {
    if (!this.configurationService.get('ENABLE_FEATURE_AUTH_OIDC')) {
      throw new HttpException(
        getReasonPhrase(StatusCodes.FORBIDDEN),
        StatusCodes.FORBIDDEN
      );
    }

    const { flowId, url } = await this.oidcService.createAuthorizationRequest();

    // The cookie binds the flow to this browser. It is sent along the
    // top-level redirect back from the provider, hence SameSite=Lax
    response.cookie(OIDC_FLOW_COOKIE_NAME, flowId, {
      httpOnly: true,
      maxAge: OIDC_FLOW_TTL,
      path: '/api/auth/oidc',
      sameSite: 'lax',
      secure: this.oidcService.getCallbackUrl().startsWith('https:')
    });

    response.redirect(url);
  }

  @Get('oidc/callback')
  @Version(VERSION_NEUTRAL)
  public async oidcLoginCallback(
    @Req() request: Request,
    @Res() response: Response
  ) {
    if (!this.configurationService.get('ENABLE_FEATURE_AUTH_OIDC')) {
      throw new HttpException(
        getReasonPhrase(StatusCodes.FORBIDDEN),
        StatusCodes.FORBIDDEN
      );
    }

    const authUrl = `${this.configurationService.get(
      'ROOT_URL'
    )}/${DEFAULT_LANGUAGE_CODE}/auth`;

    const flowId = request.cookies?.[OIDC_FLOW_COOKIE_NAME];

    response.clearCookie(OIDC_FLOW_COOKIE_NAME, { path: '/api/auth/oidc' });

    // Keep the code (or the token) out of the Referer header
    response.setHeader('Referrer-Policy', 'no-referrer');

    try {
      const jwt = await this.oidcService.handleCallback({
        flowId,
        search: new URL(request.originalUrl, 'http://localhost').search
      });

      if (this.configurationService.get('OIDC_LEGACY_TOKEN_REDIRECT')) {
        response.redirect(`${authUrl}/${jwt}`);
      } else {
        response.redirect(
          `${authUrl}?code=${this.oidcService.createExchangeCode(jwt)}`
        );
      }
    } catch (error) {
      this.logger.error(
        `Authentication with the oidc strategy has failed: ${
          error instanceof Error ? error.message : error
        }`
      );

      response.redirect(`${authUrl}?error=oidc`);
    }
  }

  @Post('oidc/exchange')
  @UseGuards(CustomThrottlerGuard)
  @Version(VERSION_NEUTRAL)
  public oidcExchange(@Body() body: { code: string }): OAuthResponse {
    const authToken = this.oidcService.exchangeCode(body?.code);

    if (!authToken) {
      throw new HttpException(
        getReasonPhrase(StatusCodes.FORBIDDEN),
        StatusCodes.FORBIDDEN
      );
    }

    return { authToken };
  }

  @Post('webauthn/generate-authentication-options')
  @UseGuards(CustomThrottlerGuard)
  public async generateAuthenticationOptions(
    @Body() body: GenerateAuthenticationOptionsDto
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    return this.webAuthService.generateAuthenticationOptions(body.deviceId);
  }

  @Get('webauthn/generate-registration-options')
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async generateRegistrationOptions(): Promise<PublicKeyCredentialCreationOptionsJSON> {
    return this.webAuthService.generateRegistrationOptions();
  }

  @Post('webauthn/verify-attestation')
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async verifyAttestation(
    @Body() body: { deviceName: string; credential: AttestationCredentialJSON }
  ): Promise<AuthDeviceDto> {
    return this.webAuthService.verifyAttestation(body.credential);
  }

  @Post('webauthn/verify-authentication')
  @UseGuards(CustomThrottlerGuard)
  public async verifyAuthentication(
    @Body() body: { deviceId: string; credential: AssertionCredentialJSON }
  ): Promise<OAuthResponse> {
    try {
      const authToken = await this.webAuthService.verifyAuthentication(
        body.deviceId,
        body.credential
      );
      return { authToken };
    } catch {
      throw new HttpException(
        getReasonPhrase(StatusCodes.FORBIDDEN),
        StatusCodes.FORBIDDEN
      );
    }
  }
}
