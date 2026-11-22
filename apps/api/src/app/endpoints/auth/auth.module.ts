import { ApiKeyService } from '@ghostfolio/api/services/api-key/api-key.service';
import { ApiModule } from '@ghostfolio/api/services/api/api.module';
import { AuthDeviceModule } from '@ghostfolio/api/services/auth-device/auth-device.module';
import { ConfigurationModule } from '@ghostfolio/api/services/configuration/configuration.module';
import { FetchModule } from '@ghostfolio/api/services/fetch/fetch.module';
import { PrismaModule } from '@ghostfolio/api/services/prisma/prisma.module';
import { PropertyModule } from '@ghostfolio/api/services/property/property.module';
import { PortfolioSnapshotQueueModule } from '@ghostfolio/api/services/queues/portfolio-snapshot/portfolio-snapshot.module';
import { RedisCacheModule } from '@ghostfolio/api/services/redis-cache/redis-cache.module';
import { UserModule } from '@ghostfolio/api/services/user/user.module';

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import type { StringValue } from 'ms';

import { ApiKeyStrategy } from './api-key.strategy';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleStrategy } from './google.strategy';
import { JwtStrategy } from './jwt.strategy';
import { OidcService } from './oidc.service';
import { WebAuthService } from './web-auth.service';

@Module({
  controllers: [AuthController],
  imports: [
    ApiModule,
    AuthDeviceModule,
    ConfigurationModule,
    FetchModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET_KEY,
      signOptions: {
        expiresIn: (process.env.JWT_EXPIRES_IN || '180 days') as StringValue
      }
    }),
    PortfolioSnapshotQueueModule,
    PrismaModule,
    PropertyModule,
    RedisCacheModule,
    UserModule
  ],
  providers: [
    ApiKeyService,
    ApiKeyStrategy,
    AuthService,
    GoogleStrategy,
    JwtStrategy,
    OidcService,
    WebAuthService
  ]
})
export class AuthModule {}
