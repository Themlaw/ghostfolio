import { ConfigurationModule } from '@ghostfolio/api/services/configuration/configuration.module';
import { ImpersonationModule } from '@ghostfolio/api/services/impersonation/impersonation.module';
import { PrismaModule } from '@ghostfolio/api/services/prisma/prisma.module';

import { Module } from '@nestjs/common';

import { PushController } from './push.controller';
import { PushService } from './push.service';

@Module({
  controllers: [PushController],
  exports: [PushService],
  imports: [ConfigurationModule, ImpersonationModule, PrismaModule],
  providers: [PushService]
})
export class PushModule {}
