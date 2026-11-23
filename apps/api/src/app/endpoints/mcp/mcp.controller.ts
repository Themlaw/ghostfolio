import { Impersonation } from '@ghostfolio/api/decorators/impersonation.decorator';
import { RequiresScopeOfAccess } from '@ghostfolio/api/decorators/requires-scope-of-access.decorator';
import { McpToolExceptionFilter } from '@ghostfolio/api/filters/mcp-tool-exception.filter';
import { PortfolioTableService } from '@ghostfolio/api/services/portfolio-table/portfolio-table.service';
import { MCP_MAX_ACTIVITIES } from '@ghostfolio/common/config';
import { SubscriptionType } from '@ghostfolio/common/enums';
import { hasScope, scopes } from '@ghostfolio/common/scopes';
import type { ImpersonationContext } from '@ghostfolio/common/types';

import { UseFilters } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { McpController, Tool } from '@rekog/mcp-nest';
import ms from 'ms';
import { z } from 'zod';
import 'zod/compile';

import {
  CREATE_ACCOUNT_PARAMETERS,
  DELETE_ACTIVITY_PARAMETERS,
  GATHER_MARKET_DATA_PARAMETERS,
  GET_ACCOUNTS_PARAMETERS,
  GET_ACTIVITIES_PARAMETERS,
  GET_DECISION_ANSWERS_PARAMETERS,
  GET_MARKET_DATA_PARAMETERS,
  GET_PERFORMANCE_PARAMETERS,
  GET_REPORT_PARAMETERS,
  GET_REPORTS_PARAMETERS,
  IMPORT_ACTIVITIES_PARAMETERS,
  PUBLISH_REPORT_PARAMETERS,
  SEARCH_ASSET_PROFILES_PARAMETERS,
  SEND_NOTIFICATION_PARAMETERS,
  UPDATE_ACCOUNT_BALANCE_PARAMETERS,
  UPDATE_ACCOUNT_PARAMETERS,
  UPDATE_ACTIVITY_PARAMETERS,
  UPDATE_REPORT_PARAMETERS
} from './mcp.schemas';
import {
  GATHER_MARKET_DATA_INTERVAL,
  MARKET_DATA_MAX_POINTS,
  McpService
} from './mcp.service';

@McpController()
@UseFilters(McpToolExceptionFilter)
export class GhostfolioMcpController {
  public constructor(private readonly mcpService: McpService) {}

  @RequiresScopeOfAccess(scopes.accountRead)
  @Tool({
    annotations: {
      openWorldHint: false,
      readOnlyHint: true,
      title: 'Get accounts'
    },
    description: `Gives the accounts of the portfolio with these columns: ${PortfolioTableService.getAccountsTableColumnNames().join(
      ', '
    )}. If the access reads the monetary values, these columns are given in addition: ${PortfolioTableService.getAccountsTableValueColumnNames().join(
      ', '
    )}. The allocation in percentage is relative to the accounts of the result, hence the parameters change it. The parameters change the value in base currency as well. With the holding parameter or with asset classes which do not include LIQUIDITY, it is the value of the matching holdings in the account without the cash balance. Otherwise, it includes the full cash balance of the account. The balance is always the full cash balance of the account in the currency of the account.`,
    name: 'get-accounts',
    parameters: GET_ACCOUNTS_PARAMETERS
  })
  public async getAccounts(
    @Impersonation()
    { scopes: impersonationScopes, userId }: ImpersonationContext,
    @Payload() parameters: z.infer<typeof GET_ACCOUNTS_PARAMETERS>
  ) {
    return this.mcpService.getAccounts({
      ...parameters,
      userId,
      withValues: this.hasScopeToReadValues(impersonationScopes)
    });
  }

  @RequiresScopeOfAccess(scopes.activityRead)
  @Tool({
    annotations: {
      openWorldHint: false,
      readOnlyHint: true,
      title: 'Get activities'
    },
    description: `Gives the activities of the portfolio, the most recent first, with these columns: ${PortfolioTableService.getActivitiesTableColumnNames().join(
      ', '
    )}. If the access reads the monetary values, these columns are given in addition: ${PortfolioTableService.getActivitiesTableValueColumnNames().join(
      ', '
    )}. The unit price and the fee are in the currency of the activity. At most ${MCP_MAX_ACTIVITIES} activities are given per call, hence narrow the result with the parameters or get the further activities with the skip parameter.`,
    name: 'get-activities',
    parameters: GET_ACTIVITIES_PARAMETERS
  })
  public async getActivities(
    @Impersonation()
    { scopes: impersonationScopes, userId, userSettings }: ImpersonationContext,
    @Payload() parameters: z.infer<typeof GET_ACTIVITIES_PARAMETERS>
  ) {
    return this.mcpService.getActivities({
      ...parameters,
      userId,
      userCurrency: userSettings.baseCurrency,
      withValues: this.hasScopeToReadValues(impersonationScopes)
    });
  }

  @RequiresScopeOfAccess(scopes.portfolioRead)
  @Tool({
    annotations: {
      openWorldHint: false,
      readOnlyHint: true,
      title: 'Get performance'
    },
    description: `Gives the performance of the portfolio in the date range with these columns: ${PortfolioTableService.getPerformanceTableColumnNames().join(
      ', '
    )}. If the access reads the monetary values, these columns are given in addition: ${PortfolioTableService.getPerformanceTableValueColumnNames().join(
      ', '
    )}. The value in base currency is the value at the end of the date range. The asset performance excludes the effect of the exchange rates, the currency performance is that effect, and the net performance is the sum of both in the base currency of the user. Each performance uses the performance calculation type of the user (default: return on average investment, ROAI) and includes the dividends (total return). The accounts and the activities which are excluded from analysis are not part of the performance. The parameters limit the performance to the holdings of the accounts, of the asset classes or of the asset profile.`,
    name: 'get-performance',
    parameters: GET_PERFORMANCE_PARAMETERS
  })
  public async getPerformance(
    @Impersonation()
    {
      scopes: impersonationScopes,
      userId,
      userSubscription
    }: ImpersonationContext,
    @Payload() parameters: z.infer<typeof GET_PERFORMANCE_PARAMETERS>
  ) {
    return this.mcpService.getPerformance({
      ...parameters,
      userId,
      withAssetPerformanceInBaseCurrency:
        userSubscription?.type !== SubscriptionType.Basic,
      withValues: this.hasScopeToReadValues(impersonationScopes)
    });
  }

  @RequiresScopeOfAccess(scopes.portfolioRead)
  @Tool({
    annotations: {
      openWorldHint: false,
      readOnlyHint: true,
      title: 'Get portfolio'
    },
    description: `Gives the holdings of the portfolio with these columns: ${PortfolioTableService.getHoldingsTableColumnNames().join(
      ', '
    )}. If the access reads the monetary values, these columns are given in addition: ${PortfolioTableService.getHoldingsTableValueColumnNames().join(
      ', '
    )}.`,
    name: 'get-portfolio'
  })
  public async getPortfolio(
    @Impersonation()
    { scopes: impersonationScopes, userId }: ImpersonationContext
  ) {
    return this.mcpService.getPortfolio({
      userId,
      withValues: this.hasScopeToReadValues(impersonationScopes)
    });
  }

  @RequiresScopeOfAccess(scopes.watchlistRead)
  @Tool({
    annotations: {
      openWorldHint: false,
      readOnlyHint: true,
      title: 'Get watchlist'
    },
    description: `Gives the watchlist of the user, sorted by name, with these columns: ${PortfolioTableService.getWatchlistTableColumnNames().join(
      ', '
    )}. A trend compares the average market price of the last 50 or 200 days with the average of the 50 or 200 days before. A trend is UNKNOWN if there is not sufficient market data. The change from the all time high is the difference between the current market price and the all time high in percentage.`,
    name: 'get-watchlist'
  })
  public async getWatchlist(@Impersonation() { userId }: ImpersonationContext) {
    return this.mcpService.getWatchlist({ userId });
  }

  @RequiresScopeOfAccess(scopes.activityCreate)
  @Tool({
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: false,
      title: 'Import activities'
    },
    description: `Imports activities into the portfolio and gives the number of the imported activities and the number of the skipped activities. Use search-asset-profiles first unless the exact symbol and data source are already known. An activity is skipped if an equal activity is in the portfolio already, hence send each activity one time only: two equal activities of the same call are both imported. At most ${MCP_MAX_ACTIVITIES} activities are imported per call, while the instance can have a lower limit, which an error names. An error does not remove the activities of the same call which are imported already, hence get the activities after an error before you import them again.`,
    name: 'import-activities',
    parameters: IMPORT_ACTIVITIES_PARAMETERS
  })
  public async importActivities(
    @Impersonation() { userId }: ImpersonationContext,
    @Payload() parameters: z.infer<typeof IMPORT_ACTIVITIES_PARAMETERS>
  ) {
    return this.mcpService.importActivities({ ...parameters, userId });
  }

  @RequiresScopeOfAccess(scopes.activityCreate)
  @Tool({
    annotations: {
      openWorldHint: true,
      readOnlyHint: true,
      title: 'Search asset profiles'
    },
    description:
      'Searches for financial assets, such as stocks, ETFs, cryptocurrencies, mutual funds and commodities, which are available to the user. Each result is an asset profile that can be used to import an activity. Use this before importing an activity unless the exact symbol and data source are already known. Select the candidate that matches the intended asset and pass its symbol, dataSource and currency unchanged to import-activities.',
    name: 'search-asset-profiles',
    parameters: SEARCH_ASSET_PROFILES_PARAMETERS
  })
  public async searchAssetProfiles(
    @Impersonation() { userId }: ImpersonationContext,
    @Payload() parameters: z.infer<typeof SEARCH_ASSET_PROFILES_PARAMETERS>
  ) {
    return this.mcpService.searchAssetProfiles({ ...parameters, userId });
  }

  @RequiresScopeOfAccess(scopes.accountUpdate)
  @Tool({
    annotations: {
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
      readOnlyHint: false,
      title: 'Update account balance'
    },
    description:
      'Sets the cash balance of an account at a date. The balance is in the currency of the account, which get-accounts gives. A cash balance of the account at the same date is replaced. The cash balance at the most recent date is the current cash balance of the account. A date in the future is refused.',
    name: 'update-account-balance',
    parameters: UPDATE_ACCOUNT_BALANCE_PARAMETERS
  })
  public async updateAccountBalance(
    @Impersonation() { userId }: ImpersonationContext,
    @Payload() parameters: z.infer<typeof UPDATE_ACCOUNT_BALANCE_PARAMETERS>
  ) {
    return this.mcpService.updateAccountBalance({ ...parameters, userId });
  }

  @RequiresScopeOfAccess(scopes.accountCreate)
  @Tool({
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: false,
      title: 'Create account'
    },
    description:
      'Creates an account of the user with a name, a currency, an optional platform and an optional initial cash balance, and gives the identifier, the name, the currency and the platform of the account. The currency is an ISO 4217 code in upper case. The platform is the name or the identifier of an existing platform, and an unknown platform is refused with the list of the available platforms. The initial cash balance is in the currency of the account and is stored as the cash balance of today. Each call creates a new account, hence check with get-accounts whether the account exists.',
    name: 'create-account',
    parameters: CREATE_ACCOUNT_PARAMETERS
  })
  public async createAccount(
    @Impersonation() { userId }: ImpersonationContext,
    @Payload() parameters: z.infer<typeof CREATE_ACCOUNT_PARAMETERS>
  ) {
    return this.mcpService.createAccount({ ...parameters, userId });
  }

  @RequiresScopeOfAccess(scopes.accountUpdate)
  @Tool({
    annotations: {
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
      readOnlyHint: false,
      title: 'Update account'
    },
    description:
      'Updates the name, the currency or the platform of an account of the user, which replace the previous value. A field which is omitted stays as it is, and a platform of null removes the platform. The platform is the name or the identifier of an existing platform. It does not change the cash balance, which update-account-balance sets. Only an account of the user can be updated.',
    name: 'update-account',
    parameters: UPDATE_ACCOUNT_PARAMETERS
  })
  public async updateAccount(
    @Impersonation() { userId }: ImpersonationContext,
    @Payload() parameters: z.infer<typeof UPDATE_ACCOUNT_PARAMETERS>
  ) {
    return this.mcpService.updateAccount({ ...parameters, userId });
  }

  @RequiresScopeOfAccess(scopes.activityUpdate, scopes.portfolioReadValues)
  @Tool({
    annotations: {
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
      readOnlyHint: false,
      title: 'Update activity'
    },
    description:
      'Updates fields of an activity of the user, which replace the previous value: the date, the quantity, the unit price, the fee, the currency, the account and the comment. A field which is omitted stays as it is, an account of null removes the account and an empty comment removes the comment. The type, the symbol and the data source of an activity cannot be changed, hence delete the activity with delete-activity and import it again with import-activities instead. The unit price and the fee are in the currency of the activity. The portfolio is recalculated after the change. Use get-activities to get the identifier of the activity.',
    name: 'update-activity',
    parameters: UPDATE_ACTIVITY_PARAMETERS
  })
  public async updateActivity(
    @Impersonation()
    { scopes: impersonationScopes, userId }: ImpersonationContext,
    @Payload() parameters: z.infer<typeof UPDATE_ACTIVITY_PARAMETERS>
  ) {
    return this.mcpService.updateActivity({
      ...parameters,
      userId,
      withValues: this.hasScopeToReadValues(impersonationScopes)
    });
  }

  @RequiresScopeOfAccess(scopes.activityDelete, scopes.portfolioReadValues)
  @Tool({
    annotations: {
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
      readOnlyHint: false,
      title: 'Delete activity'
    },
    description:
      'Deletes an activity of the user permanently and gives the deleted activity. The portfolio is recalculated after the deletion. An asset profile without other activity, without a watchlist item and without a benchmark role is deleted with its market data. Use get-activities to get the identifier of the activity, and confirm with the user before you delete an activity.',
    name: 'delete-activity',
    parameters: DELETE_ACTIVITY_PARAMETERS
  })
  public async deleteActivity(
    @Impersonation()
    { scopes: impersonationScopes, userId }: ImpersonationContext,
    @Payload() parameters: z.infer<typeof DELETE_ACTIVITY_PARAMETERS>
  ) {
    return this.mcpService.deleteActivity({
      ...parameters,
      userId,
      withValues: this.hasScopeToReadValues(impersonationScopes)
    });
  }

  @RequiresScopeOfAccess(scopes.activityCreate)
  @Tool({
    annotations: {
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
      readOnlyHint: false,
      title: 'Gather market data'
    },
    description: `Queues the gathering of the market prices of an asset profile from its data provider, like the button to gather the data of an asset profile does, and gives what was queued. The gathering runs in the background, hence read the market prices with get-market-data a few minutes later. Only an asset profile which is in the portfolio (an activity) or in the watchlist of the user is accepted. The gathering covers the last 30 days, or the whole history since the first activity of the portfolio with fullHistory. The market prices which the data provider gives replace the stored ones. The same user can gather the same asset profile once per ${ms(
      GATHER_MARKET_DATA_INTERVAL,
      { long: true }
    )}, and a further call in this interval is refused.`,
    name: 'gather-market-data',
    parameters: GATHER_MARKET_DATA_PARAMETERS
  })
  public async gatherMarketData(
    @Impersonation() { userId }: ImpersonationContext,
    @Payload() parameters: z.infer<typeof GATHER_MARKET_DATA_PARAMETERS>
  ) {
    return this.mcpService.gatherMarketData({ ...parameters, userId });
  }

  @RequiresScopeOfAccess(scopes.portfolioRead)
  @Tool({
    annotations: {
      openWorldHint: false,
      readOnlyHint: true,
      title: 'Get market data'
    },
    description: `Gives the stored market prices of an asset profile in the date range, the oldest first, with these columns: ${PortfolioTableService.getMarketDataTableColumnNames().join(
      ', '
    )}. It reads the database and does not call the data provider, hence use gather-market-data if the market prices are missing or outdated. Only an asset profile which is in the portfolio or in the watchlist of the user is accepted. A market price is not a value of the portfolio, hence an access without the permission to read the values gets it as well. At most ${MARKET_DATA_MAX_POINTS} market prices are given: a longer range gives the last market price of each week, or of each month if that is still too long. Use get-portfolio or get-watchlist to get the data source and the symbol.`,
    name: 'get-market-data',
    parameters: GET_MARKET_DATA_PARAMETERS
  })
  public async getMarketData(
    @Impersonation() { userId }: ImpersonationContext,
    @Payload() parameters: z.infer<typeof GET_MARKET_DATA_PARAMETERS>
  ) {
    return this.mcpService.getMarketData({ ...parameters, userId });
  }

  @RequiresScopeOfAccess(scopes.notificationCreate)
  @Tool({
    annotations: {
      openWorldHint: false,
      readOnlyHint: true,
      title: 'Get notification status'
    },
    description:
      'Gives the number of the devices of the user which are subscribed to the notifications and whether the instance has the keys (VAPID) to send them. It never gives the endpoint or the keys of a device. Check it before send-notification: without a subscribed device, a notification reaches nobody.',
    name: 'get-notification-status'
  })
  public async getNotificationStatus(
    @Impersonation() { userId }: ImpersonationContext
  ) {
    return this.mcpService.getNotificationStatus({ userId });
  }

  @RequiresScopeOfAccess(scopes.reportRead)
  @Tool({
    annotations: {
      openWorldHint: false,
      readOnlyHint: true,
      title: 'Get decision answers'
    },
    description:
      'Gives the decisions which the user decided in the application, the most recently decided first, with the question, the options, the chosen option and the text of the answer. Use the since parameter to read only the answers since the last report, before you publish the next one.',
    name: 'get-decision-answers',
    parameters: GET_DECISION_ANSWERS_PARAMETERS
  })
  public async getDecisionAnswers(
    @Impersonation() { userId }: ImpersonationContext,
    @Payload() parameters: z.infer<typeof GET_DECISION_ANSWERS_PARAMETERS>
  ) {
    return this.mcpService.getDecisionAnswers({ ...parameters, userId });
  }

  @RequiresScopeOfAccess(scopes.reportRead)
  @Tool({
    annotations: {
      openWorldHint: false,
      readOnlyHint: true,
      title: 'Get open decisions'
    },
    description:
      'Gives the decisions which the user has not decided yet, with the question, the options and the report which asked it. Check it before you publish a report, to not ask a question twice.',
    name: 'get-open-decisions'
  })
  public async getOpenDecisions(
    @Impersonation() { userId }: ImpersonationContext
  ) {
    return this.mcpService.getOpenDecisions({ userId });
  }

  @RequiresScopeOfAccess(scopes.reportRead)
  @Tool({
    annotations: {
      openWorldHint: false,
      readOnlyHint: true,
      title: 'Get report'
    },
    description:
      'Gives a report of the user with its points, decisions, concepts, details and sources.',
    name: 'get-report',
    parameters: GET_REPORT_PARAMETERS
  })
  public async getReport(
    @Impersonation() { userId }: ImpersonationContext,
    @Payload() parameters: z.infer<typeof GET_REPORT_PARAMETERS>
  ) {
    return this.mcpService.getReport({ ...parameters, userId });
  }

  @RequiresScopeOfAccess(scopes.reportRead)
  @Tool({
    annotations: {
      openWorldHint: false,
      readOnlyHint: true,
      title: 'Get reports'
    },
    description:
      'Gives the reports of the user, the most recently published first, which match the filters. At most 20 reports are given per call, hence get the further reports with the skip parameter.',
    name: 'get-reports',
    parameters: GET_REPORTS_PARAMETERS
  })
  public async getReports(
    @Impersonation() { userId }: ImpersonationContext,
    @Payload() parameters: z.infer<typeof GET_REPORTS_PARAMETERS>
  ) {
    return this.mcpService.getReports({ ...parameters, userId });
  }

  @RequiresScopeOfAccess(scopes.reportCreate)
  @Tool({
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: false,
      title: 'Publish report'
    },
    description:
      'Publishes a report to the user: a brief, an analysis, a lesson, an allocation proposal or a review. A report has points with a level (important, note or info), optional concepts, details as markdown, sources and decisions. A decision is a question with options, which the user answers in the application. A report with an important point or with a decision notifies the user. Each call publishes a new report, hence check with get-reports whether the report exists already.',
    name: 'publish-report',
    parameters: PUBLISH_REPORT_PARAMETERS
  })
  public async publishReport(
    @Impersonation() { userId }: ImpersonationContext,
    @Payload() parameters: z.infer<typeof PUBLISH_REPORT_PARAMETERS>
  ) {
    return this.mcpService.publishReport({ ...parameters, userId });
  }

  @RequiresScopeOfAccess(scopes.notificationCreate)
  @Tool({
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: false,
      title: 'Send notification'
    },
    description:
      'Sends a push notification with a title, a text and an optional URL to the devices of the user, and gives the number of the devices which it reached. If the number is 0, no device is subscribed (or the delivery failed) and the user has to enable the notifications in the application, which get-notification-status tells beforehand. Use it sparingly, only for what the user has to see soon.',
    name: 'send-notification',
    parameters: SEND_NOTIFICATION_PARAMETERS
  })
  public async sendNotification(
    @Impersonation() { userId }: ImpersonationContext,
    @Payload() parameters: z.infer<typeof SEND_NOTIFICATION_PARAMETERS>
  ) {
    return this.mcpService.sendNotification({ ...parameters, userId });
  }

  @RequiresScopeOfAccess(scopes.reportUpdate)
  @Tool({
    annotations: {
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      readOnlyHint: false,
      title: 'Update report'
    },
    description:
      'Updates the fields of a report, which replace the previous value, and reopens or dismisses decisions of the report. It cannot answer a decision, because only the user decides.',
    name: 'update-report',
    parameters: UPDATE_REPORT_PARAMETERS
  })
  public async updateReport(
    @Impersonation() { userId }: ImpersonationContext,
    @Payload() parameters: z.infer<typeof UPDATE_REPORT_PARAMETERS>
  ) {
    return this.mcpService.updateReport({ ...parameters, userId });
  }

  private hasScopeToReadValues(impersonationScopes: string[]) {
    return hasScope(impersonationScopes, scopes.portfolioReadValues);
  }
}
