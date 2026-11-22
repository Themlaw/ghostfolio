import { PushModule } from '@ghostfolio/api/app/endpoints/push/push.module';
import { ReportsModule } from '@ghostfolio/api/app/endpoints/reports/reports.module';
import { environment } from '@ghostfolio/api/environments/environment';
import {
  getMcpUserOfBearerToken,
  hasLimitsOfBasicSubscriptionOfBearerToken
} from '@ghostfolio/api/helper/bearer-token.helper';
import { AccountBalanceModule } from '@ghostfolio/api/services/account-balance/account-balance.module';
import { AccountModule } from '@ghostfolio/api/services/account/account.module';
import { ApiModule } from '@ghostfolio/api/services/api/api.module';
import { ConfigurationModule } from '@ghostfolio/api/services/configuration/configuration.module';
import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { ImportModule } from '@ghostfolio/api/services/import/import.module';
import { PortfolioTableModule } from '@ghostfolio/api/services/portfolio-table/portfolio-table.module';
import { PortfolioTableService } from '@ghostfolio/api/services/portfolio-table/portfolio-table.service';
import { SymbolProfileModule } from '@ghostfolio/api/services/symbol-profile/symbol-profile.module';
import { SymbolModule } from '@ghostfolio/api/services/symbol/symbol.module';
import { UserModule } from '@ghostfolio/api/services/user/user.module';
import { MCP_ENDPOINT } from '@ghostfolio/common/config';

import { Module } from '@nestjs/common';
import {
  MCP_STRATEGY,
  McpStrategy,
  StreamableHttpTransport
} from '@rekog/mcp-nest';

import { GhostfolioMcpController } from './mcp.controller';
import { McpService } from './mcp.service';

@Module({
  controllers: [GhostfolioMcpController],
  exports: [McpService],
  imports: [
    AccountBalanceModule,
    AccountModule,
    ApiModule,
    ConfigurationModule,
    ImportModule,
    PortfolioTableModule,
    PushModule,
    ReportsModule,
    SymbolModule,
    SymbolProfileModule,
    UserModule
  ],
  providers: [
    McpService,
    {
      inject: [ConfigurationService],
      provide: MCP_STRATEGY,
      useFactory: (configurationService: ConfigurationService) => {
        const { hostname } = new URL(configurationService.get('ROOT_URL'));

        const instructions =
          'Ghostfolio is a wealth management application. The tools read the portfolio and the watchlist of the user who granted the access, import activities into the portfolio and update the cash balances of the accounts. They give the quantities and the monetary values only if the access has the permission "View" or "View and manage", otherwise no quantity and no monetary value (except the unit price of an activity). Only the tools which the permission of the access covers are listed. To import activities or to update a cash balance, the access needs the permission "Restricted view and manage" or "View and manage". The tools publish-report, get-reports, get-report and update-report manage the reports of the user (brief, analysis, lesson, allocation, review), which the user reads in the application. A report can submit decisions, i.e. questions with options, which the user answers in the application: get-open-decisions gives the questions which wait for an answer and get-decision-answers gives the answers, optionally since a date, hence read them before you publish the next report. send-notification sends a push notification to the user. The scopes report:read, report:create, report:update and notification:create of the access cover these tools.';

        const instructionsOfBasicSubscription = `${instructions} The user who granted the access has the Basic subscription, hence the tool get-performance does not give these columns: ${PortfolioTableService.getAssetPerformanceInBaseCurrencyColumnNames().join(
          ', '
        )}.`;

        return new McpStrategy({
          instructions: ({ request }) => {
            return hasLimitsOfBasicSubscriptionOfBearerToken(request)
              ? instructionsOfBasicSubscription
              : instructions;
          },
          name: 'ghostfolio',
          resolveUser: getMcpUserOfBearerToken,
          title: 'Ghostfolio',
          transports: [
            new StreamableHttpTransport({
              endpoint: MCP_ENDPOINT,
              security: {
                allowedHosts: [hostname],
                allowedOrigins: [hostname]
              }
            })
          ],
          version: environment.version,
          websiteUrl: 'https://ghostfol.io'
        });
      }
    }
  ]
})
export class McpModule {}
