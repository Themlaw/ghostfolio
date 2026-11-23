import { PushService } from '@ghostfolio/api/app/endpoints/push/push.service';
import { ReportsService } from '@ghostfolio/api/app/endpoints/reports/reports.service';
import { CallerFacingError } from '@ghostfolio/api/errors/caller-facing.error';
import {
  isDataGatheringSupported,
  transformDataSourceInRequest,
  transformDataSourceInResponse
} from '@ghostfolio/api/helper/data-source.helper';
import { AccountBalanceService } from '@ghostfolio/api/services/account-balance/account-balance.service';
import { AccountService } from '@ghostfolio/api/services/account/account.service';
import { ActivitiesService } from '@ghostfolio/api/services/activities/activities.service';
import { ApiService } from '@ghostfolio/api/services/api/api.service';
import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { ImportService } from '@ghostfolio/api/services/import/import.service';
import { MarketDataService } from '@ghostfolio/api/services/market-data/market-data.service';
import { PlatformService } from '@ghostfolio/api/services/platform/platform.service';
import { PortfolioTableService } from '@ghostfolio/api/services/portfolio-table/portfolio-table.service';
import { DataGatheringService } from '@ghostfolio/api/services/queues/data-gathering/data-gathering.service';
import { RedisCacheService } from '@ghostfolio/api/services/redis-cache/redis-cache.service';
import { SymbolProfileService } from '@ghostfolio/api/services/symbol-profile/symbol-profile.service';
import { SymbolService } from '@ghostfolio/api/services/symbol/symbol.service';
import { UserService } from '@ghostfolio/api/services/user/user.service';
import { getIntervalFromDateRange } from '@ghostfolio/common/calculation-helper';
import { DEFAULT_LANGUAGE_CODE } from '@ghostfolio/common/config';
import { DATE_FORMAT } from '@ghostfolio/common/helper';
import { hasPermission, permissions } from '@ghostfolio/common/permissions';

import { utc } from '@date-fns/utc';
import { HttpException, Injectable } from '@nestjs/common';
import { DataSource } from '@prisma/client';
import { format, parseISO, startOfDay, startOfWeek, subDays } from 'date-fns';
import { getReasonPhrase, StatusCodes } from 'http-status-codes';
import ms from 'ms';
import { z } from 'zod';

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

/**
 * The minimum interval between two gatherings of the market data of the same
 * asset profile by the same user
 */
export const GATHER_MARKET_DATA_INTERVAL = ms('15 minutes');

/**
 * The number of days which a gathering without the full history covers
 */
const GATHER_MARKET_DATA_RECENT_DAYS = 30;

/**
 * The maximum number of market prices which a call gives. A longer range is
 * sampled weekly, and monthly if that is still too long.
 */
export const MARKET_DATA_MAX_POINTS = 250;

const MAX_PLATFORMS_IN_ERROR = 50;

const NO_DEVICE_HINT =
  'No device of the user is subscribed or the delivery failed. Ask the user to enable the notifications in the application (page Reports, "Enable notifications", or the notification settings in the account settings) and to allow them in the browser.';

@Injectable()
export class McpService {
  public constructor(
    private readonly accountBalanceService: AccountBalanceService,
    private readonly accountService: AccountService,
    private readonly activitiesService: ActivitiesService,
    private readonly apiService: ApiService,
    private readonly configurationService: ConfigurationService,
    private readonly dataGatheringService: DataGatheringService,
    private readonly importService: ImportService,
    private readonly marketDataService: MarketDataService,
    private readonly platformService: PlatformService,
    private readonly portfolioTableService: PortfolioTableService,
    private readonly pushService: PushService,
    private readonly redisCacheService: RedisCacheService,
    private readonly reportsService: ReportsService,
    private readonly symbolProfileService: SymbolProfileService,
    private readonly symbolService: SymbolService,
    private readonly userService: UserService
  ) {}

  public async createAccount({
    balance,
    currency,
    name,
    platform,
    userId
  }: z.infer<typeof CREATE_ACCOUNT_PARAMETERS> & { userId: string }) {
    await this.getUserWithPermission({
      userId,
      permission: permissions.createAccount
    });

    const platformId = platform
      ? await this.getPlatformId({ platform })
      : undefined;

    const account = await this.accountService.createAccount({
      balance,
      userId,
      data: {
        currency,
        name,
        platform: platformId ? { connect: { id: platformId } } : undefined,
        user: { connect: { id: userId } }
      }
    });

    return this.getTextResult(
      this.getAccountSummary({
        platformName: await this.getPlatformName({ platformId }),
        account,
        title: 'Created the account'
      })
    );
  }

  public async deleteActivity({
    id,
    userId,
    withValues = false
  }: z.infer<typeof DELETE_ACTIVITY_PARAMETERS> & {
    userId: string;
    withValues?: boolean;
  }) {
    await this.getUserWithPermission({
      userId,
      permission: permissions.deleteActivity
    });

    const { activity, symbolProfile } = await this.getActivityOfUser({
      id,
      userId
    });

    // The service emits the event which recalculates the portfolio
    await this.activitiesService.deleteActivity({ id: activity.id });

    return this.getTextResult(
      this.getActivitySummary({
        activity,
        symbolProfile,
        withValues,
        title: 'Deleted the activity'
      })
    );
  }

  public async gatherMarketData({
    dataSource: dataSourceOfParameters,
    fullHistory,
    symbol,
    userId
  }: z.infer<typeof GATHER_MARKET_DATA_PARAMETERS> & { userId: string }) {
    await this.getUserWithPermission({
      userId,
      permission: permissions.createActivity
    });

    const dataSource = transformDataSourceInRequest({
      configurationService: this.configurationService,
      dataSource: dataSourceOfParameters
    });

    const symbolProfile = await this.getSymbolProfileOfUser({
      dataSource,
      symbol,
      userId
    });

    if (!symbolProfile.isActive || !isDataGatheringSupported(symbolProfile)) {
      throw new CallerFacingError(
        'The market data of this asset profile cannot be gathered, because it is inactive or has no data provider.'
      );
    }

    const key = `mcp-gather-market-data-${userId}-${dataSource}-${symbol}`;

    if (await this.redisCacheService.get(key)) {
      throw new CallerFacingError(
        `The market data of this asset profile was gathered in the last ${ms(
          GATHER_MARKET_DATA_INTERVAL,
          { long: true }
        )} already. Try again later or read the market data with get-market-data.`
      );
    }

    // Reserve the interval before the gathering, so that a parallel call is
    // refused. The reservation is released if nothing is queued.
    await this.redisCacheService.set(
      key,
      new Date().toISOString(),
      GATHER_MARKET_DATA_INTERVAL
    );

    let jobs: Awaited<ReturnType<DataGatheringService['gatherSymbol']>>;

    try {
      jobs = await this.dataGatheringService.gatherSymbol({
        dataSource,
        symbol,
        date: fullHistory
          ? undefined
          : subDays(startOfDay(new Date()), GATHER_MARKET_DATA_RECENT_DAYS)
      });
    } catch (error) {
      await this.redisCacheService.remove(key);

      throw error;
    }

    if (!jobs?.length) {
      await this.redisCacheService.remove(key);

      throw new CallerFacingError(
        'Nothing was queued: the data provider of this asset profile does not gather it.'
      );
    }

    const date = (jobs[0]?.data as { date?: Date | string } | undefined)?.date;

    return this.getTextResult(
      [
        `Queued the gathering of the market data of ${symbol} (${transformDataSourceInResponse(
          { dataSource, configurationService: this.configurationService }
        )}): ${jobs.length} job(s)${
          date
            ? ` from ${format(new Date(date), DATE_FORMAT, { in: utc })}`
            : ''
        }.`,
        'The gathering runs in the background, hence read the market prices with get-market-data in a few minutes.'
      ].join('\n')
    );
  }

  public async getAccounts({
    accountIds,
    assetClasses,
    holding,
    userId,
    withValues
  }: z.infer<typeof GET_ACCOUNTS_PARAMETERS> & {
    userId: string;
    withValues?: boolean;
  }) {
    const filters = this.apiService.buildFiltersFromQueryParams({
      ...this.getHoldingFilterParameters({ holding }),
      filterByAccounts: accountIds,
      filterByAssetClasses: assetClasses
    });

    const table = await this.portfolioTableService.getAccountsTable({
      filters,
      userId,
      withValues
    });

    return this.getTextResult(table);
  }

  public async getActivities({
    activityTypes,
    assetClasses,
    holding,
    range,
    skip,
    take,
    userCurrency,
    userId,
    withValues
  }: z.infer<typeof GET_ACTIVITIES_PARAMETERS> & {
    userCurrency: string;
    userId: string;
    withValues?: boolean;
  }) {
    let endDate: Date | undefined;
    let startDate: Date | undefined;

    if (range) {
      ({ endDate, startDate } = getIntervalFromDateRange({
        dateRange: range
      }));
    }

    const filters = this.apiService.buildFiltersFromQueryParams({
      ...this.getHoldingFilterParameters({ holding }),
      filterByAssetClasses: assetClasses
    });

    const table = await this.portfolioTableService.getActivitiesTable({
      endDate,
      filters,
      skip,
      startDate,
      take,
      userCurrency,
      userId,
      withValues,
      types: activityTypes
    });

    return this.getTextResult(table);
  }

  /**
   * Gives the currency, the data source, the ISIN, the name and the symbol of
   * the active asset profiles of the investment activities of the user, also
   * of the closed positions and of the excluded accounts. It is not a tool: the
   * import of activities with Ghostfolio AI uses it to match the assets
   * without the portfolio calculation of the tool get-portfolio.
   */
  public async getAssetProfilesOfUser({ userId }: { userId: string }) {
    const symbolProfiles =
      await this.symbolProfileService.getSymbolProfilesOfUser({ userId });

    return symbolProfiles.map(
      ({ currency, dataSource, isin, name, symbol }) => {
        return {
          currency,
          isin,
          name,
          symbol,
          dataSource: transformDataSourceInResponse({
            dataSource,
            configurationService: this.configurationService
          })
        };
      }
    );
  }

  public async getDecisionAnswers({
    since,
    userId
  }: z.infer<typeof GET_DECISION_ANSWERS_PARAMETERS> & { userId: string }) {
    this.assertReportsEnabled();

    const decisions = await this.reportsService.getDecisions({
      userId,
      since: since ? new Date(since) : undefined,
      status: 'DECIDED'
    });

    return this.getJsonResult({ decisions });
  }

  public async getMarketData({
    dataSource: dataSourceOfParameters,
    range,
    symbol,
    userId
  }: z.infer<typeof GET_MARKET_DATA_PARAMETERS> & { userId: string }) {
    const dataSource = transformDataSourceInRequest({
      configurationService: this.configurationService,
      dataSource: dataSourceOfParameters
    });

    const symbolProfile = await this.getSymbolProfileOfUser({
      dataSource,
      symbol,
      userId
    });

    const { endDate, startDate } = getIntervalFromDateRange({
      dateRange: range
    });

    const marketData = await this.marketDataService.getRange({
      assetProfileIdentifiers: [{ dataSource, symbol }],
      dateQuery: { gte: startDate, lt: endDate }
    });

    const { marketData: sampledMarketData, sampling } =
      this.sampleMarketData(marketData);

    const table = await this.portfolioTableService.getMarketDataTable({
      sampling,
      currency: symbolProfile.currency,
      marketData: sampledMarketData,
      numberOfMarketPrices: marketData.length
    });

    return this.getTextResult(table);
  }

  public async getNotificationStatus({ userId }: { userId: string }) {
    const subscriptionCount = await this.pushService.getSubscriptionCount({
      userId
    });

    const isConfigured = this.pushService.isConfigured();

    const lines = [
      `Subscribed devices: ${subscriptionCount}`,
      `Notifications configured on this instance (VAPID keys): ${
        isConfigured ? 'yes' : 'no'
      }`
    ];

    if (!isConfigured) {
      lines.push(
        'The instance cannot send notifications until the VAPID keys are configured.'
      );
    } else if (subscriptionCount === 0) {
      lines.push(NO_DEVICE_HINT);
    }

    return this.getTextResult(lines.join('\n'));
  }

  public async getOpenDecisions({ userId }: { userId: string }) {
    this.assertReportsEnabled();

    const decisions = await this.reportsService.getDecisions({
      userId,
      status: 'OPEN'
    });

    return this.getJsonResult({ decisions });
  }

  public async getPerformance({
    accountIds,
    assetClasses,
    holding,
    range,
    userId,
    withAssetPerformanceInBaseCurrency,
    withValues
  }: z.infer<typeof GET_PERFORMANCE_PARAMETERS> & {
    userId: string;
    withAssetPerformanceInBaseCurrency?: boolean;
    withValues?: boolean;
  }) {
    const filters = this.apiService.buildFiltersFromQueryParams({
      ...this.getHoldingFilterParameters({ holding }),
      filterByAccounts: accountIds,
      filterByAssetClasses: assetClasses
    });

    const table = await this.portfolioTableService.getPerformanceTable({
      filters,
      userId,
      withAssetPerformanceInBaseCurrency,
      withValues,
      dateRange: range
    });

    return this.getTextResult(table);
  }

  public async getPortfolio({
    userId,
    withValues
  }: {
    userId: string;
    withValues?: boolean;
  }) {
    const table = await this.portfolioTableService.getHoldingsTable({
      userId,
      withValues,
      languageCode: DEFAULT_LANGUAGE_CODE,
      withDataSource: true
    });

    return this.getTextResult(table);
  }

  public async getReport({
    id,
    userId
  }: z.infer<typeof GET_REPORT_PARAMETERS> & { userId: string }) {
    this.assertReportsEnabled();

    const report = await this.reportsService.getReport({ id, userId });

    if (!report) {
      throw new CallerFacingError(
        'The report does not exist. Use get-reports to get the identifier of the report.'
      );
    }

    return this.getJsonResult(report);
  }

  public async getReports({
    userId,
    ...parameters
  }: z.infer<typeof GET_REPORTS_PARAMETERS> & { userId: string }) {
    this.assertReportsEnabled();

    return this.getJsonResult(
      await this.reportsService.getReports({ ...parameters, userId })
    );
  }

  public async getWatchlist({ userId }: { userId: string }) {
    const table = await this.portfolioTableService.getWatchlistTable({
      userId
    });

    return this.getTextResult(table);
  }

  public async importActivities({
    activities,
    userId
  }: z.infer<typeof IMPORT_ACTIVITIES_PARAMETERS> & { userId: string }) {
    const user = await this.getUserWithPermission({
      userId,
      permission: permissions.createActivity
    });

    const activitiesDto = activities.map((activity) => {
      return {
        ...activity,
        dataSource: transformDataSourceInRequest({
          configurationService: this.configurationService,
          dataSource: activity.dataSource
        })
      };
    });

    // The filter passes on the message of a CallerFacingError, which is
    // written for the caller, and hides the message of every other error
    const importedActivities = await this.importService.import({
      activitiesDto,
      user,
      accountsWithBalancesDto: [],
      assetProfilesWithMarketDataDto: [],
      platformsDto: [],
      tagsDto: []
    });

    const text = [
      `Imported activities: ${importedActivities.length}`,
      `Skipped duplicate activities: ${
        activities.length - importedActivities.length
      }`
    ].join('\n');

    return this.getTextResult(text);
  }

  public async publishReport({
    userId,
    ...parameters
  }: z.infer<typeof PUBLISH_REPORT_PARAMETERS> & { userId: string }) {
    this.assertReportsEnabled();

    await this.getUserWithPermission({
      userId,
      permission: permissions.createReport
    });

    const report = await this.reportsService.createReport({
      userId,
      data: parameters
    });

    return this.getJsonResult(report);
  }

  public async searchAssetProfiles({
    query,
    userId
  }: z.infer<typeof SEARCH_ASSET_PROFILES_PARAMETERS> & { userId: string }) {
    const user = await this.getUserWithPermission({
      userId,
      permission: permissions.createActivity
    });

    const { items } = await this.symbolService.lookup({ query, user });

    const assetProfiles = items.flatMap(
      ({
        assetClass,
        assetSubClass,
        currency,
        dataProviderInfo,
        dataSource,
        name,
        symbol
      }) => {
        if (!dataSource || dataProviderInfo.isPremium) {
          return [];
        }

        return [
          {
            assetClass,
            assetSubClass,
            currency,
            name,
            symbol,
            dataSource: transformDataSourceInResponse({
              dataSource,
              configurationService: this.configurationService
            })
          }
        ];
      }
    );

    return this.getTextResult(JSON.stringify({ assetProfiles }, null, 2));
  }

  public async sendNotification({
    body,
    title,
    url,
    userId
  }: z.infer<typeof SEND_NOTIFICATION_PARAMETERS> & { userId: string }) {
    if (!this.pushService.isConfigured()) {
      throw new CallerFacingError(
        'The notifications are not configured on this instance'
      );
    }

    const deliveries = await this.pushService.sendToUser({
      userId,
      notification: { body, title, url }
    });

    if (deliveries === 0) {
      return this.getTextResult(
        `Sent the notification to 0 device(s): no device received it. ${NO_DEVICE_HINT}`
      );
    }

    return this.getTextResult(
      `Sent the notification to ${deliveries} device(s)`
    );
  }

  public async updateAccountBalance({
    accountId,
    balance,
    date,
    userId
  }: z.infer<typeof UPDATE_ACCOUNT_BALANCE_PARAMETERS> & { userId: string }) {
    await this.getUserWithPermission({
      userId,
      permission: permissions.createAccountBalance
    });

    const account = await this.accountService.account({
      id_userId: {
        userId,
        id: accountId
      }
    });

    if (!account) {
      throw new CallerFacingError(
        'The account does not exist. Use get-accounts to get the identifier of the account.'
      );
    }

    await this.accountBalanceService.createOrUpdateAccountBalance({
      balance,
      date,
      accountId: account.id,
      userId: account.userId
    });

    return this.getTextResult(
      `Updated the cash balance of the account at ${date}`
    );
  }

  public async updateAccount({
    currency,
    id,
    name,
    platform,
    userId
  }: z.infer<typeof UPDATE_ACCOUNT_PARAMETERS> & { userId: string }) {
    await this.getUserWithPermission({
      userId,
      permission: permissions.updateAccount
    });

    if (
      currency === undefined &&
      name === undefined &&
      platform === undefined
    ) {
      throw new CallerFacingError(
        'Nothing to update: pass at least one of name, currency and platform.'
      );
    }

    // The account has to belong to the user of the access
    const originalAccount = await this.accountService.account({
      id_userId: { id, userId }
    });

    if (!originalAccount) {
      throw new CallerFacingError(
        'The account does not exist. Use get-accounts to get the identifier of the account.'
      );
    }

    const platformId = platform
      ? await this.getPlatformId({ platform })
      : undefined;

    const account = await this.accountService.updateAccount({
      userId,
      data: {
        currency,
        name,
        platform: platformId
          ? { connect: { id: platformId } }
          : platform === null && originalAccount.platformId
            ? { disconnect: true }
            : undefined,
        user: { connect: { id: userId } }
      },
      where: { id_userId: { id, userId } }
    });

    return this.getTextResult(
      this.getAccountSummary({
        account,
        platformName: await this.getPlatformName({
          platformId: account.platformId
        }),
        title: 'Updated the account'
      })
    );
  }

  public async updateActivity({
    accountId,
    comment,
    currency,
    date,
    fee,
    id,
    quantity,
    unitPrice,
    userId,
    withValues = false
  }: z.infer<typeof UPDATE_ACTIVITY_PARAMETERS> & {
    userId: string;
    withValues?: boolean;
  }) {
    await this.getUserWithPermission({
      userId,
      permission: permissions.updateActivity
    });

    if (
      [accountId, comment, currency, date, fee, quantity, unitPrice].every(
        (value) => {
          return value === undefined;
        }
      )
    ) {
      throw new CallerFacingError(
        'Nothing to update: pass at least one field to change.'
      );
    }

    const { activity: originalActivity, symbolProfile } =
      await this.getActivityOfUser({ id, userId });

    // The account has to belong to the user of the access
    if (accountId) {
      const account = await this.accountService.account({
        id_userId: { userId, id: accountId }
      });

      if (!account) {
        throw new CallerFacingError(
          'The account does not exist. Use get-accounts to get the identifier of the account.'
        );
      }
    }

    // The service emits the event which recalculates the portfolio and
    // replaces the comment by null if it is empty, hence the unchanged fields
    // are passed on
    const activity = await this.activitiesService.updateActivity({
      data: {
        account:
          accountId === undefined
            ? undefined
            : accountId === null
              ? { disconnect: true }
              : { connect: { id_userId: { userId, id: accountId } } },
        comment: comment ?? originalActivity.comment,
        currency:
          currency ?? originalActivity.currency ?? symbolProfile.currency,
        date: date ? parseISO(date) : originalActivity.date,
        fee: fee ?? originalActivity.fee,
        quantity: quantity ?? originalActivity.quantity,
        SymbolProfile: {
          connect: {
            dataSource_symbol: {
              dataSource: symbolProfile.dataSource,
              symbol: symbolProfile.symbol
            }
          }
        },
        type: originalActivity.type,
        unitPrice: unitPrice ?? originalActivity.unitPrice,
        user: { connect: { id: userId } }
      },
      originalDate: originalActivity.date,
      userId,
      where: { id: originalActivity.id }
    });

    return this.getTextResult(
      this.getActivitySummary({
        activity,
        symbolProfile,
        withValues,
        title: 'Updated the activity'
      })
    );
  }

  public async updateReport({
    decisions,
    id,
    userId,
    ...data
  }: z.infer<typeof UPDATE_REPORT_PARAMETERS> & { userId: string }) {
    this.assertReportsEnabled();

    await this.getUserWithPermission({
      userId,
      permission: permissions.updateReport
    });

    const report = await this.reportsService.updateReport({
      data,
      id,
      userId
    });

    if (!report) {
      throw new CallerFacingError(
        'The report does not exist. Use get-reports to get the identifier of the report.'
      );
    }

    for (const { id: decisionId, status } of decisions ?? []) {
      const isOfReport = report.decisions.some(({ id: idOfDecision }) => {
        return idOfDecision === decisionId;
      });

      if (!isOfReport) {
        throw new CallerFacingError(
          `The decision ${decisionId} does not belong to the report`
        );
      }

      await this.reportsService.setDecisionStatus({
        status,
        userId,
        id: decisionId
      });
    }

    return this.getJsonResult(
      await this.reportsService.getReport({ id, userId })
    );
  }

  private assertReportsEnabled() {
    if (!this.configurationService.get('ENABLE_FEATURE_REPORTS')) {
      throw new CallerFacingError('The reports are disabled on this instance');
    }
  }

  private getAccountSummary({
    account,
    platformName,
    title
  }: {
    account: { currency: string | null; id: string; name: string | null };
    platformName?: string;
    title: string;
  }) {
    // The cash balance is not part of the summary
    return [
      title,
      `Id: ${account.id}`,
      `Name: ${account.name ?? ''}`,
      `Currency: ${account.currency ?? ''}`,
      `Platform: ${platformName ?? ''}`
    ].join('\n');
  }

  /**
   * Gives the activity of the user with its asset profile. An activity of
   * another user is reported as missing.
   */
  private async getActivityOfUser({
    id,
    userId
  }: {
    id: string;
    userId: string;
  }) {
    const activity = await this.activitiesService.order({ id, userId });

    if (activity?.userId !== userId) {
      throw new CallerFacingError(
        'The activity does not exist. Use get-activities to get the identifier of the activity.'
      );
    }

    const [symbolProfile] =
      await this.symbolProfileService.getSymbolProfilesByIds([
        activity.symbolProfileId
      ]);

    return { activity, symbolProfile };
  }

  private getActivitySummary({
    activity,
    symbolProfile,
    title,
    withValues
  }: {
    activity: {
      accountId: string | null;
      currency: string | null;
      date: Date;
      fee: number;
      id: string;
      quantity: number;
      type: string;
      unitPrice: number;
    };
    symbolProfile: { currency?: string; symbol: string };
    title: string;
    withValues: boolean;
  }) {
    const lines = [
      title,
      `Id: ${activity.id}`,
      `Date: ${format(activity.date, DATE_FORMAT)}`,
      `Type: ${activity.type}`,
      `Symbol: ${symbolProfile.symbol}`,
      `Currency: ${activity.currency ?? symbolProfile.currency}`,
      `Unit Price: ${activity.unitPrice}`,
      `Account Id: ${activity.accountId ?? ''}`
    ];

    // The quantity and the fee are values, which an access without the
    // permission to read the values does not read
    if (withValues) {
      lines.push(`Quantity: ${activity.quantity}`, `Fee: ${activity.fee}`);
    }

    return lines.join('\n');
  }

  private getHoldingFilterParameters({
    holding
  }: Pick<z.infer<typeof GET_ACCOUNTS_PARAMETERS>, 'holding'>) {
    return {
      filterByDataSource: transformDataSourceInRequest({
        configurationService: this.configurationService,
        dataSource: holding?.dataSource
      }),
      filterBySymbol: holding?.symbol
    };
  }

  private async getPlatformId({ platform }: { platform: string }) {
    const platforms = await this.platformService.getPlatforms({
      orderBy: { name: 'asc' }
    });

    const platformOfId = platforms.find(({ id }) => {
      return id === platform;
    });

    if (platformOfId) {
      return platformOfId.id;
    }

    const platformsOfName = platforms.filter(({ name }) => {
      return name?.toLowerCase() === platform.toLowerCase();
    });

    if (platformsOfName.length === 1) {
      return platformsOfName[0].id;
    }

    if (platformsOfName.length > 1) {
      throw new CallerFacingError(
        'Several platforms have this name, hence pass the identifier of the platform.'
      );
    }

    const names = platforms
      .map(({ name }) => {
        return name;
      })
      .filter(Boolean)
      .slice(0, MAX_PLATFORMS_IN_ERROR);

    throw new CallerFacingError(
      `The platform does not exist. Available platforms: ${names.join(', ')}`
    );
  }

  private async getPlatformName({ platformId }: { platformId?: string }) {
    if (!platformId) {
      return undefined;
    }

    return (await this.platformService.getPlatform({ id: platformId }))?.name;
  }

  /**
   * Gives the asset profile if it is in the portfolio or in the watchlist of
   * the user, otherwise it refuses, hence a tool cannot probe or trigger an
   * asset profile of another user
   */
  private async getSymbolProfileOfUser({
    dataSource,
    symbol,
    userId
  }: {
    dataSource: DataSource;
    symbol: string;
    userId: string;
  }) {
    const symbolProfile =
      await this.symbolProfileService.getSymbolProfileOfUser({
        dataSource,
        symbol,
        userId
      });

    if (!symbolProfile) {
      throw new CallerFacingError(
        'The asset profile is neither in the portfolio nor in the watchlist of the user. Use get-portfolio or get-watchlist to get the data source and the symbol.'
      );
    }

    return symbolProfile;
  }

  private getJsonResult(value: unknown) {
    return this.getTextResult(JSON.stringify(value, null, 2));
  }

  private getTextResult(text: string) {
    return { content: [{ text, type: 'text' as const }] };
  }

  /**
   * Keeps the last market price of each week, or of each month if that is
   * still too long, if there are more market prices than the maximum
   */
  private sampleMarketData<T extends { date: Date }>(
    marketData: T[]
  ): { marketData: T[]; sampling?: 'monthly' | 'weekly' } {
    if (marketData.length <= MARKET_DATA_MAX_POINTS) {
      return { marketData, sampling: undefined };
    }

    const getLastOfEach = (getKey: (date: Date) => string) => {
      const lastByKey = new Map<string, T>();

      for (const item of marketData) {
        lastByKey.set(getKey(item.date), item);
      }

      return [...lastByKey.values()];
    };

    const weekly = getLastOfEach((date) => {
      return format(
        startOfWeek(date, { in: utc, weekStartsOn: 1 }),
        DATE_FORMAT,
        {
          in: utc
        }
      );
    });

    if (weekly.length <= MARKET_DATA_MAX_POINTS) {
      return { marketData: weekly, sampling: 'weekly' as const };
    }

    return {
      marketData: getLastOfEach((date) => {
        return format(date, 'yyyy-MM', { in: utc });
      }),
      sampling: 'monthly' as const
    };
  }

  /**
   * Gives the user of the access, if the role of the user has the permission.
   * The scope of the access is evaluated separately by the ScopeGuard, hence a
   * tool which changes data has to call this.
   */
  private async getUserWithPermission({
    permission,
    userId
  }: {
    permission: string;
    userId: string;
  }) {
    const user = await this.userService.user({ id: userId });

    if (!hasPermission(user?.permissions, permission)) {
      throw new HttpException(
        getReasonPhrase(StatusCodes.FORBIDDEN),
        StatusCodes.FORBIDDEN
      );
    }

    return user;
  }
}
