import { ConfigurationModule } from '@ghostfolio/api/services/configuration/configuration.module';
import { PrismaModule } from '@ghostfolio/api/services/prisma/prisma.module';

import { Module } from '@nestjs/common';

import { McpOAuthFeatureGuard } from './mcp-oauth-feature.guard';
import { OAuthMetadataController } from './oauth-metadata.controller';
import { OAuthController } from './oauth.controller';
import { OAuthService } from './oauth.service';

@Module({
  controllers: [OAuthController, OAuthMetadataController],
  exports: [OAuthService],
  imports: [ConfigurationModule, PrismaModule],
  providers: [McpOAuthFeatureGuard, OAuthService]
})
export class OAuthModule {}
