import { ConfigurationModule } from '@ghostfolio/api/services/configuration/configuration.module';
import { ImpersonationModule } from '@ghostfolio/api/services/impersonation/impersonation.module';
import { PrismaModule } from '@ghostfolio/api/services/prisma/prisma.module';

import { Module } from '@nestjs/common';

import { PushModule } from '../push/push.module';
import { ReportsFeatureGuard } from './reports-feature.guard';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  controllers: [ReportsController],
  exports: [ReportsService],
  imports: [ConfigurationModule, ImpersonationModule, PrismaModule, PushModule],
  providers: [ReportsFeatureGuard, ReportsService]
})
export class ReportsModule {}
