import { PushService } from '@ghostfolio/api/app/endpoints/push/push.service';
import { ReportsService } from '@ghostfolio/api/app/endpoints/reports/reports.service';
import { CallerFacingError } from '@ghostfolio/api/errors/caller-facing.error';
import { encodeDataSource } from '@ghostfolio/api/helper/data-source.helper';
import { AccountBalanceService } from '@ghostfolio/api/services/account-balance/account-balance.service';
import { AccountService } from '@ghostfolio/api/services/account/account.service';
import { ActivitiesService } from '@ghostfolio/api/services/activities/activities.service';
import { ApiService } from '@ghostfolio/api/services/api/api.service';
import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { ImportValidationError } from '@ghostfolio/api/services/import/errors/import-validation.error';
import { ImportService } from '@ghostfolio/api/services/import/import.service';
import { MarketDataService } from '@ghostfolio/api/services/market-data/market-data.service';
import { PlatformService } from '@ghostfolio/api/services/platform/platform.service';
import { PortfolioTableService } from '@ghostfolio/api/services/portfolio-table/portfolio-table.service';
import { DataGatheringService } from '@ghostfolio/api/services/queues/data-gathering/data-gathering.service';
import { RedisCacheService } from '@ghostfolio/api/services/redis-cache/redis-cache.service';
import { SymbolProfileService } from '@ghostfolio/api/services/symbol-profile/symbol-profile.service';
import { SymbolService } from '@ghostfolio/api/services/symbol/symbol.service';
import { UserService } from '@ghostfolio/api/services/user/user.service';
import {
  DEFAULT_LANGUAGE_CODE,
  MCP_MAX_ACTIVITIES
} from '@ghostfolio/common/config';
import { Activity, Filter } from '@ghostfolio/common/interfaces';
import { permissions } from '@ghostfolio/common/permissions';
import type {
  AccountWithBalance,
  UserWithSettings
} from '@ghostfolio/common/types';

import { HttpException } from '@nestjs/common';
import {
  AssetClass,
  AssetSubClass,
  DataSource,
  Type as ActivityType
} from '@prisma/client';

import {
  GATHER_MARKET_DATA_INTERVAL,
  MARKET_DATA_MAX_POINTS,
  McpService
} from './mcp.service';
import { createActivity } from './mcp.test-utils';

describe('McpService', () => {
  const filters: Filter[] = [{ id: 'account-id', type: 'ACCOUNT' }];
  const userCurrency = 'USD';
  const userId = 'user-id';

  let accountBalanceService: AccountBalanceService;
  let accountService: AccountService;
  let activitiesService: ActivitiesService;
  let apiService: ApiService;
  let configuration: Record<string, unknown>;
  let configurationService: ConfigurationService;
  let dataGatheringService: DataGatheringService;
  let importService: ImportService;
  let marketDataService: MarketDataService;
  let mcpService: McpService;
  let platformService: PlatformService;
  let portfolioTableService: PortfolioTableService;
  let pushService: PushService;
  let redisCache: Map<string, string>;
  let redisCacheService: RedisCacheService;
  let reportsService: ReportsService;
  let symbolProfileService: SymbolProfileService;
  let symbolService: SymbolService;
  let userService: UserService;

  function setupUser(userPermissions: string[]) {
    const user = {
      id: userId,
      permissions: userPermissions
    } as UserWithSettings;

    jest.spyOn(userService, 'user').mockResolvedValue(user);

    return user;
  }

  beforeEach(() => {
    configuration = {
      DATA_SOURCES_GHOSTFOLIO_DATA_PROVIDER: [],
      ENABLE_FEATURE_REPORTS: true,
      ENABLE_FEATURE_SUBSCRIPTION: false
    };

    configurationService = {
      get: jest.fn().mockImplementation((key: string) => {
        return configuration[key];
      })
    } as unknown as ConfigurationService;

    accountBalanceService = {
      createOrUpdateAccountBalance: jest.fn()
    } as unknown as AccountBalanceService;

    accountService = {
      account: jest.fn(),
      createAccount: jest.fn().mockResolvedValue({
        currency: 'EUR',
        id: 'new-account-id',
        name: 'Broker'
      }),
      updateAccount: jest.fn().mockResolvedValue({
        currency: 'EUR',
        id: 'account-id',
        name: 'Broker',
        platformId: null
      })
    } as unknown as AccountService;

    activitiesService = {
      deleteActivity: jest.fn(),
      order: jest.fn(),
      updateActivity: jest.fn()
    } as unknown as ActivitiesService;

    apiService = {
      buildFiltersFromQueryParams: jest.fn().mockReturnValue(filters)
    } as unknown as ApiService;

    dataGatheringService = {
      gatherSymbol: jest
        .fn()
        .mockResolvedValue([{ data: { date: new Date('2024-01-01') } }])
    } as unknown as DataGatheringService;

    importService = {
      import: jest.fn().mockResolvedValue([])
    } as unknown as ImportService;

    marketDataService = {
      getRange: jest.fn().mockResolvedValue([])
    } as unknown as MarketDataService;

    platformService = {
      getPlatform: jest.fn().mockResolvedValue({ name: 'Broker X' }),
      getPlatforms: jest.fn().mockResolvedValue([
        { id: 'platform-1', name: 'Broker X' },
        { id: 'platform-2', name: 'Bank Y' }
      ])
    } as unknown as PlatformService;

    portfolioTableService = {
      getAccountsTable: jest.fn().mockResolvedValue('## Accounts'),
      getActivitiesTable: jest.fn().mockResolvedValue('## Activities'),
      getHoldingsTable: jest.fn().mockResolvedValue('## Holdings'),
      getMarketDataTable: jest.fn().mockResolvedValue('## Market Data'),
      getPerformanceTable: jest.fn().mockResolvedValue('## Performance'),
      getWatchlistTable: jest.fn().mockResolvedValue('## Watchlist')
    } as unknown as PortfolioTableService;

    pushService = {
      getSubscriptionCount: jest.fn().mockResolvedValue(2),
      isConfigured: jest.fn().mockReturnValue(true),
      sendToUser: jest.fn().mockResolvedValue(2)
    } as unknown as PushService;

    redisCache = new Map<string, string>();

    redisCacheService = {
      get: jest.fn().mockImplementation(async (key: string) => {
        return redisCache.get(key);
      }),
      remove: jest.fn().mockImplementation(async (key: string) => {
        redisCache.delete(key);
      }),
      set: jest.fn().mockImplementation(async (key: string, value: string) => {
        redisCache.set(key, value);
      })
    } as unknown as RedisCacheService;

    reportsService = {
      createReport: jest.fn().mockResolvedValue({ id: 'report-id' }),
      getDecisions: jest.fn().mockResolvedValue([]),
      getReport: jest.fn().mockResolvedValue({
        decisions: [{ id: 'decision-id' }],
        id: 'report-id'
      }),
      getReports: jest.fn().mockResolvedValue({ count: 0, reports: [] }),
      setDecisionStatus: jest.fn(),
      updateReport: jest.fn().mockResolvedValue({
        decisions: [{ id: 'decision-id' }],
        id: 'report-id'
      })
    } as unknown as ReportsService;

    symbolProfileService = {
      getSymbolProfileOfUser: jest.fn().mockResolvedValue({
        currency: 'USD',
        dataSource: DataSource.YAHOO,
        isActive: true,
        scraperConfiguration: null,
        symbol: 'AAPL'
      }),
      getSymbolProfilesByIds: jest.fn().mockResolvedValue([
        {
          currency: 'USD',
          dataSource: DataSource.YAHOO,
          id: 'symbol-profile-id',
          symbol: 'AAPL'
        }
      ]),
      getSymbolProfilesOfUser: jest.fn().mockResolvedValue([])
    } as unknown as SymbolProfileService;

    symbolService = {
      lookup: jest.fn().mockResolvedValue({ items: [] })
    } as unknown as SymbolService;

    userService = { user: jest.fn() } as unknown as UserService;

    mcpService = new McpService(
      accountBalanceService,
      accountService,
      activitiesService,
      apiService,
      configurationService,
      dataGatheringService,
      importService,
      marketDataService,
      platformService,
      portfolioTableService,
      pushService,
      redisCacheService,
      reportsService,
      symbolProfileService,
      symbolService,
      userService
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getAccounts', () => {
    it('Maps the parameters of the tool to the filters', async () => {
      await mcpService.getAccounts({
        userId,
        accountIds: ['account-id'],
        assetClasses: [AssetClass.EQUITY],
        holding: { dataSource: DataSource.YAHOO, symbol: 'AAPL' }
      });

      expect(apiService.buildFiltersFromQueryParams).toHaveBeenCalledWith({
        filterByAccounts: ['account-id'],
        filterByAssetClasses: [AssetClass.EQUITY],
        filterByDataSource: DataSource.YAHOO,
        filterBySymbol: 'AAPL'
      });
    });

    it('Resolves the mask of the data source of the Ghostfolio data provider', async () => {
      configuration.DATA_SOURCES_GHOSTFOLIO_DATA_PROVIDER = [DataSource.YAHOO];
      configuration.ENABLE_FEATURE_SUBSCRIPTION = true;

      await mcpService.getAccounts({
        userId,
        holding: { dataSource: DataSource.GHOSTFOLIO, symbol: 'AAPL' }
      });

      expect(apiService.buildFiltersFromQueryParams).toHaveBeenCalledWith(
        expect.objectContaining({ filterByDataSource: DataSource.YAHOO })
      );
    });

    it('Decodes an encoded data source', async () => {
      configuration.ENABLE_FEATURE_SUBSCRIPTION = true;

      await mcpService.getAccounts({
        userId,
        holding: {
          dataSource: encodeDataSource(DataSource.YAHOO),
          symbol: 'AAPL'
        }
      });

      expect(apiService.buildFiltersFromQueryParams).toHaveBeenCalledWith(
        expect.objectContaining({ filterByDataSource: DataSource.YAHOO })
      );
    });

    it('Keeps the data source if the subscription is not enabled', async () => {
      configuration.DATA_SOURCES_GHOSTFOLIO_DATA_PROVIDER = [DataSource.YAHOO];
      configuration.ENABLE_FEATURE_SUBSCRIPTION = false;

      await mcpService.getAccounts({
        userId,
        holding: { dataSource: DataSource.GHOSTFOLIO, symbol: 'AAPL' }
      });

      expect(apiService.buildFiltersFromQueryParams).toHaveBeenCalledWith(
        expect.objectContaining({ filterByDataSource: DataSource.GHOSTFOLIO })
      );
    });

    it('Gives the table of the accounts of the filters', async () => {
      expect(await mcpService.getAccounts({ userId })).toEqual({
        content: [{ text: '## Accounts', type: 'text' }]
      });

      expect(portfolioTableService.getAccountsTable).toHaveBeenCalledWith({
        filters,
        userId
      });
    });

    it('Gives the values if the access reads them', async () => {
      await mcpService.getAccounts({ userId, withValues: true });

      expect(portfolioTableService.getAccountsTable).toHaveBeenCalledWith(
        expect.objectContaining({ withValues: true })
      );
    });
  });

  describe('getActivities', () => {
    function getActivities(
      parameters: Partial<Parameters<McpService['getActivities']>[0]> = {}
    ) {
      return mcpService.getActivities({
        userCurrency,
        userId,
        take: MCP_MAX_ACTIVITIES,
        ...parameters
      });
    }

    it('Maps the parameters of the tool to the filters', async () => {
      await getActivities({
        assetClasses: [AssetClass.EQUITY],
        holding: { dataSource: DataSource.YAHOO, symbol: 'AAPL' }
      });

      expect(apiService.buildFiltersFromQueryParams).toHaveBeenCalledWith({
        filterByAssetClasses: [AssetClass.EQUITY],
        filterByDataSource: DataSource.YAHOO,
        filterBySymbol: 'AAPL'
      });
    });

    it('Resolves the mask of the data source of the Ghostfolio data provider', async () => {
      configuration.DATA_SOURCES_GHOSTFOLIO_DATA_PROVIDER = [DataSource.YAHOO];
      configuration.ENABLE_FEATURE_SUBSCRIPTION = true;

      await getActivities({
        holding: { dataSource: DataSource.GHOSTFOLIO, symbol: 'AAPL' }
      });

      expect(apiService.buildFiltersFromQueryParams).toHaveBeenCalledWith(
        expect.objectContaining({ filterByDataSource: DataSource.YAHOO })
      );
    });

    it('Decodes an encoded data source', async () => {
      configuration.ENABLE_FEATURE_SUBSCRIPTION = true;

      await getActivities({
        holding: {
          dataSource: encodeDataSource(DataSource.YAHOO),
          symbol: 'AAPL'
        }
      });

      expect(apiService.buildFiltersFromQueryParams).toHaveBeenCalledWith(
        expect.objectContaining({ filterByDataSource: DataSource.YAHOO })
      );
    });

    it('Keeps the data source if the subscription is not enabled', async () => {
      configuration.DATA_SOURCES_GHOSTFOLIO_DATA_PROVIDER = [DataSource.YAHOO];
      configuration.ENABLE_FEATURE_SUBSCRIPTION = false;

      await getActivities({
        holding: { dataSource: DataSource.GHOSTFOLIO, symbol: 'AAPL' }
      });

      expect(apiService.buildFiltersFromQueryParams).toHaveBeenCalledWith(
        expect.objectContaining({ filterByDataSource: DataSource.GHOSTFOLIO })
      );
    });

    it('Changes the range into the start date and the end date', async () => {
      await getActivities({ range: '2024' });

      expect(portfolioTableService.getActivitiesTable).toHaveBeenCalledWith(
        expect.objectContaining({
          endDate: new Date('2024-12-31T23:59:59.999Z'),
          startDate: new Date('2023-12-31T23:59:59.999Z')
        })
      );
    });

    it('Gives no date if the range is absent', async () => {
      await getActivities();

      expect(portfolioTableService.getActivitiesTable).toHaveBeenCalledWith(
        expect.objectContaining({ endDate: undefined, startDate: undefined })
      );
    });

    it('Gives the table of the activities of the filters', async () => {
      expect(
        await getActivities({ activityTypes: [ActivityType.BUY], skip: 10 })
      ).toEqual({ content: [{ text: '## Activities', type: 'text' }] });

      expect(portfolioTableService.getActivitiesTable).toHaveBeenCalledWith({
        filters,
        userCurrency,
        userId,
        endDate: undefined,
        skip: 10,
        startDate: undefined,
        take: MCP_MAX_ACTIVITIES,
        types: [ActivityType.BUY]
      });
    });

    it('Gives the values if the access reads them', async () => {
      await getActivities({ withValues: true });

      expect(portfolioTableService.getActivitiesTable).toHaveBeenCalledWith(
        expect.objectContaining({ withValues: true })
      );
    });
  });

  describe('getAssetProfilesOfUser', () => {
    it('Gives the currency, the data source, the ISIN, the name and the symbol of the asset profiles of the user', async () => {
      jest
        .spyOn(symbolProfileService, 'getSymbolProfilesOfUser')
        .mockResolvedValue([
          {
            currency: 'USD',
            dataSource: DataSource.YAHOO,
            isin: 'US0378331005',
            name: 'Apple Inc.',
            symbol: 'AAPL'
          }
        ]);

      await expect(
        mcpService.getAssetProfilesOfUser({ userId })
      ).resolves.toEqual([
        {
          currency: 'USD',
          dataSource: DataSource.YAHOO,
          isin: 'US0378331005',
          name: 'Apple Inc.',
          symbol: 'AAPL'
        }
      ]);

      expect(symbolProfileService.getSymbolProfilesOfUser).toHaveBeenCalledWith(
        { userId }
      );
    });

    it('Encodes the data source if the subscription is enabled', async () => {
      configuration.DATA_SOURCES_GHOSTFOLIO_DATA_PROVIDER = [DataSource.YAHOO];
      configuration.ENABLE_FEATURE_SUBSCRIPTION = true;

      jest
        .spyOn(symbolProfileService, 'getSymbolProfilesOfUser')
        .mockResolvedValue([
          {
            currency: 'USD',
            dataSource: DataSource.YAHOO,
            isin: 'US0378331005',
            name: 'Apple Inc.',
            symbol: 'AAPL'
          }
        ]);

      await expect(
        mcpService.getAssetProfilesOfUser({ userId })
      ).resolves.toEqual([
        expect.objectContaining({
          dataSource: encodeDataSource(DataSource.YAHOO)
        })
      ]);
    });
  });

  describe('getPerformance', () => {
    it('Maps the parameters of the tool to the filters', async () => {
      await mcpService.getPerformance({
        userId,
        accountIds: ['account-id'],
        assetClasses: [AssetClass.EQUITY],
        holding: { dataSource: DataSource.YAHOO, symbol: 'AAPL' },
        range: 'max'
      });

      expect(apiService.buildFiltersFromQueryParams).toHaveBeenCalledWith({
        filterByAccounts: ['account-id'],
        filterByAssetClasses: [AssetClass.EQUITY],
        filterByDataSource: DataSource.YAHOO,
        filterBySymbol: 'AAPL'
      });
    });

    it('Resolves the mask of the data source of the Ghostfolio data provider', async () => {
      configuration.DATA_SOURCES_GHOSTFOLIO_DATA_PROVIDER = [DataSource.YAHOO];
      configuration.ENABLE_FEATURE_SUBSCRIPTION = true;

      await mcpService.getPerformance({
        userId,
        holding: { dataSource: DataSource.GHOSTFOLIO, symbol: 'AAPL' },
        range: 'max'
      });

      expect(apiService.buildFiltersFromQueryParams).toHaveBeenCalledWith(
        expect.objectContaining({ filterByDataSource: DataSource.YAHOO })
      );
    });

    it('Decodes an encoded data source', async () => {
      configuration.ENABLE_FEATURE_SUBSCRIPTION = true;

      await mcpService.getPerformance({
        userId,
        holding: {
          dataSource: encodeDataSource(DataSource.YAHOO),
          symbol: 'AAPL'
        },
        range: 'max'
      });

      expect(apiService.buildFiltersFromQueryParams).toHaveBeenCalledWith(
        expect.objectContaining({ filterByDataSource: DataSource.YAHOO })
      );
    });

    it('Keeps the data source if the subscription is not enabled', async () => {
      configuration.DATA_SOURCES_GHOSTFOLIO_DATA_PROVIDER = [DataSource.YAHOO];
      configuration.ENABLE_FEATURE_SUBSCRIPTION = false;

      await mcpService.getPerformance({
        userId,
        holding: { dataSource: DataSource.GHOSTFOLIO, symbol: 'AAPL' },
        range: 'max'
      });

      expect(apiService.buildFiltersFromQueryParams).toHaveBeenCalledWith(
        expect.objectContaining({ filterByDataSource: DataSource.GHOSTFOLIO })
      );
    });

    it('Gives the table of the performance of the filters in the range', async () => {
      expect(
        await mcpService.getPerformance({ userId, range: '2024' })
      ).toEqual({ content: [{ text: '## Performance', type: 'text' }] });

      expect(portfolioTableService.getPerformanceTable).toHaveBeenCalledWith({
        filters,
        userId,
        dateRange: '2024'
      });
    });

    it('Gives the values if the access reads them', async () => {
      await mcpService.getPerformance({
        userId,
        range: '2024',
        withValues: true
      });

      expect(portfolioTableService.getPerformanceTable).toHaveBeenCalledWith(
        expect.objectContaining({ withValues: true })
      );
    });

    it('Gives the asset performance in base currency if the subscription permits it', async () => {
      await mcpService.getPerformance({
        userId,
        range: '2024',
        withAssetPerformanceInBaseCurrency: true
      });

      expect(portfolioTableService.getPerformanceTable).toHaveBeenCalledWith(
        expect.objectContaining({ withAssetPerformanceInBaseCurrency: true })
      );
    });
  });

  describe('getPortfolio', () => {
    it('Gives the table of the holdings with the data source in the default language', async () => {
      expect(await mcpService.getPortfolio({ userId })).toEqual({
        content: [{ text: '## Holdings', type: 'text' }]
      });

      expect(portfolioTableService.getHoldingsTable).toHaveBeenCalledWith({
        userId,
        languageCode: DEFAULT_LANGUAGE_CODE,
        withDataSource: true
      });
    });

    it('Gives the values if the access reads them', async () => {
      await mcpService.getPortfolio({ userId, withValues: true });

      expect(portfolioTableService.getHoldingsTable).toHaveBeenCalledWith(
        expect.objectContaining({ withValues: true })
      );
    });
  });

  describe('getWatchlist', () => {
    it('Gives the table of the watchlist', async () => {
      expect(await mcpService.getWatchlist({ userId })).toEqual({
        content: [{ text: '## Watchlist', type: 'text' }]
      });

      expect(portfolioTableService.getWatchlistTable).toHaveBeenCalledWith({
        userId
      });
    });
  });

  describe('searchAssetProfiles', () => {
    it('Refuses a user without the permission to create an activity', async () => {
      setupUser([]);

      await expect(
        mcpService.searchAssetProfiles({ query: 'Apple', userId })
      ).rejects.toThrow(HttpException);

      expect(symbolService.lookup).not.toHaveBeenCalled();
    });

    it('Gives the import-ready asset profiles available to the user', async () => {
      const user = setupUser([permissions.createActivity]);

      jest.spyOn(symbolService, 'lookup').mockResolvedValue({
        items: [
          {
            assetClass: AssetClass.EQUITY,
            assetSubClass: AssetSubClass.STOCK,
            currency: 'USD',
            dataProviderInfo: { isPremium: false },
            dataSource: DataSource.YAHOO,
            name: 'Apple Inc.',
            symbol: 'AAPL'
          },
          {
            assetClass: AssetClass.EQUITY,
            assetSubClass: AssetSubClass.STOCK,
            currency: 'USD',
            dataProviderInfo: { isPremium: true },
            dataSource: DataSource.GHOSTFOLIO,
            name: 'Premium asset',
            symbol: 'PREMIUM'
          }
        ]
      });

      const result = await mcpService.searchAssetProfiles({
        query: 'Apple',
        userId
      });

      expect(symbolService.lookup).toHaveBeenCalledWith({
        query: 'Apple',
        user
      });
      expect(JSON.parse(result.content[0].text)).toEqual({
        assetProfiles: [
          {
            assetClass: AssetClass.EQUITY,
            assetSubClass: AssetSubClass.STOCK,
            currency: 'USD',
            dataSource: DataSource.YAHOO,
            name: 'Apple Inc.',
            symbol: 'AAPL'
          }
        ]
      });
    });

    it('Encodes the data source if the subscription is enabled', async () => {
      setupUser([permissions.createActivity]);

      configuration.DATA_SOURCES_GHOSTFOLIO_DATA_PROVIDER = [DataSource.YAHOO];
      configuration.ENABLE_FEATURE_SUBSCRIPTION = true;

      jest.spyOn(symbolService, 'lookup').mockResolvedValue({
        items: [
          {
            assetClass: AssetClass.EQUITY,
            assetSubClass: AssetSubClass.STOCK,
            currency: 'USD',
            dataProviderInfo: { isPremium: false },
            dataSource: DataSource.YAHOO,
            name: 'Apple Inc.',
            symbol: 'AAPL'
          }
        ]
      });

      const result = await mcpService.searchAssetProfiles({
        query: 'Apple',
        userId
      });

      expect(JSON.parse(result.content[0].text)).toEqual({
        assetProfiles: [
          expect.objectContaining({
            dataSource: encodeDataSource(DataSource.YAHOO)
          })
        ]
      });
    });
  });

  describe('importActivities', () => {
    it('Refuses a user without the permission to create an activity', async () => {
      setupUser([]);

      await expect(
        mcpService.importActivities({
          userId,
          activities: [createActivity()]
        })
      ).rejects.toThrow(HttpException);

      expect(importService.import).not.toHaveBeenCalled();
    });

    it('Gives the number of the imported and of the skipped activities', async () => {
      setupUser([permissions.createActivity]);

      jest
        .spyOn(importService, 'import')
        .mockResolvedValue([{ id: 'activity-id' } as Activity]);

      expect(
        await mcpService.importActivities({
          userId,
          activities: [createActivity(), createActivity({ quantity: 2 })]
        })
      ).toEqual({
        content: [
          {
            text: 'Imported activities: 1\nSkipped duplicate activities: 1',
            type: 'text'
          }
        ]
      });
    });

    it('Resolves the mask of the data source of the Ghostfolio data provider', async () => {
      setupUser([permissions.createActivity]);

      configuration.DATA_SOURCES_GHOSTFOLIO_DATA_PROVIDER = [DataSource.YAHOO];
      configuration.ENABLE_FEATURE_SUBSCRIPTION = true;

      await mcpService.importActivities({
        userId,
        activities: [createActivity({ dataSource: DataSource.GHOSTFOLIO })]
      });

      expect(importService.import).toHaveBeenCalledWith(
        expect.objectContaining({
          activitiesDto: [
            expect.objectContaining({ dataSource: DataSource.YAHOO })
          ]
        })
      );
    });

    it('Decodes an encoded data source', async () => {
      setupUser([permissions.createActivity]);

      configuration.ENABLE_FEATURE_SUBSCRIPTION = true;

      await mcpService.importActivities({
        userId,
        activities: [
          createActivity({ dataSource: encodeDataSource(DataSource.YAHOO) })
        ]
      });

      expect(importService.import).toHaveBeenCalledWith(
        expect.objectContaining({
          activitiesDto: [
            expect.objectContaining({ dataSource: DataSource.YAHOO })
          ]
        })
      );
    });

    it('Keeps the data source if the subscription is not enabled', async () => {
      setupUser([permissions.createActivity]);

      configuration.DATA_SOURCES_GHOSTFOLIO_DATA_PROVIDER = [DataSource.YAHOO];
      configuration.ENABLE_FEATURE_SUBSCRIPTION = false;

      await mcpService.importActivities({
        userId,
        activities: [createActivity({ dataSource: DataSource.GHOSTFOLIO })]
      });

      expect(importService.import).toHaveBeenCalledWith(
        expect.objectContaining({
          activitiesDto: [
            expect.objectContaining({ dataSource: DataSource.GHOSTFOLIO })
          ]
        })
      );
    });

    // The McpToolExceptionFilter maps the error, hence the tool passes it on
    it('Passes on an error of the import', async () => {
      setupUser([permissions.createActivity]);

      const error = new ImportValidationError(
        'activities.0.symbol ("X") is not valid'
      );

      jest.spyOn(importService, 'import').mockRejectedValue(error);

      await expect(
        mcpService.importActivities({
          userId,
          activities: [createActivity()]
        })
      ).rejects.toBe(error);
    });
  });

  describe('updateAccountBalance', () => {
    const parameters = {
      userId,
      accountId: 'account-id',
      balance: 1000,
      date: '2024-01-01'
    };

    it('Refuses a user without the permission to create an account balance', async () => {
      setupUser([]);

      await expect(mcpService.updateAccountBalance(parameters)).rejects.toThrow(
        HttpException
      );

      // The permission is checked first, hence the existence of the account
      // stays hidden
      expect(accountService.account).not.toHaveBeenCalled();

      expect(
        accountBalanceService.createOrUpdateAccountBalance
      ).not.toHaveBeenCalled();
    });

    it('Refuses an account which does not belong to the user', async () => {
      setupUser([permissions.createAccountBalance]);

      jest.spyOn(accountService, 'account').mockResolvedValue(null);

      await expect(mcpService.updateAccountBalance(parameters)).rejects.toThrow(
        CallerFacingError
      );

      expect(accountService.account).toHaveBeenCalledWith({
        id_userId: { userId, id: 'account-id' }
      });

      expect(
        accountBalanceService.createOrUpdateAccountBalance
      ).not.toHaveBeenCalled();
    });

    it('Updates the cash balance of the account of the user', async () => {
      setupUser([permissions.createAccountBalance]);

      jest
        .spyOn(accountService, 'account')
        .mockResolvedValue({ userId, id: 'account-id' } as AccountWithBalance);

      expect(await mcpService.updateAccountBalance(parameters)).toEqual({
        content: [
          {
            text: 'Updated the cash balance of the account at 2024-01-01',
            type: 'text'
          }
        ]
      });

      expect(
        accountBalanceService.createOrUpdateAccountBalance
      ).toHaveBeenCalledWith({
        userId,
        accountId: 'account-id',
        balance: 1000,
        date: '2024-01-01'
      });
    });
  });

  describe('createAccount', () => {
    const parameters = { currency: 'EUR', name: 'Broker', userId };

    it('Refuses a user without the permission to create an account', async () => {
      setupUser([]);

      await expect(mcpService.createAccount(parameters)).rejects.toThrow(
        HttpException
      );

      expect(accountService.createAccount).not.toHaveBeenCalled();
    });

    it('Creates the account of the user with a platform which is given by its name', async () => {
      setupUser([permissions.createAccount]);

      const result = await mcpService.createAccount({
        ...parameters,
        balance: 1500,
        platform: 'broker x'
      });

      expect(accountService.createAccount).toHaveBeenCalledWith({
        balance: 1500,
        userId,
        data: {
          currency: 'EUR',
          name: 'Broker',
          platform: { connect: { id: 'platform-1' } },
          user: { connect: { id: userId } }
        }
      });

      expect(result.content[0].text).toContain('Id: new-account-id');
    });

    it('Accepts the identifier of a platform', async () => {
      setupUser([permissions.createAccount]);

      await mcpService.createAccount({ ...parameters, platform: 'platform-2' });

      expect(accountService.createAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            platform: { connect: { id: 'platform-2' } }
          })
        })
      );
    });

    it('Refuses an unknown platform and lists the platforms', async () => {
      setupUser([permissions.createAccount]);

      await expect(
        mcpService.createAccount({ ...parameters, platform: 'Unknown' })
      ).rejects.toThrow(/Available platforms: Broker X, Bank Y/);

      expect(accountService.createAccount).not.toHaveBeenCalled();
    });

    it('Does not give the cash balance of the account', async () => {
      setupUser([permissions.createAccount]);

      const result = await mcpService.createAccount({
        ...parameters,
        balance: 1500
      });

      expect(result.content[0].text).not.toContain('1500');
      expect(result.content[0].text).not.toMatch(/balance/i);
    });
  });

  describe('updateAccount', () => {
    const parameters = { id: 'account-id', name: 'New name', userId };

    it('Refuses a user without the permission to update an account', async () => {
      setupUser([]);

      await expect(mcpService.updateAccount(parameters)).rejects.toThrow(
        HttpException
      );

      expect(accountService.updateAccount).not.toHaveBeenCalled();
    });

    it('Refuses an account which does not belong to the user', async () => {
      setupUser([permissions.updateAccount]);

      jest.spyOn(accountService, 'account').mockResolvedValue(null);

      await expect(mcpService.updateAccount(parameters)).rejects.toThrow(
        CallerFacingError
      );

      expect(accountService.account).toHaveBeenCalledWith({
        id_userId: { userId, id: 'account-id' }
      });
      expect(accountService.updateAccount).not.toHaveBeenCalled();
    });

    it('Refuses a call without a field to update', async () => {
      setupUser([permissions.updateAccount]);

      await expect(
        mcpService.updateAccount({ id: 'account-id', userId })
      ).rejects.toThrow(CallerFacingError);

      expect(accountService.updateAccount).not.toHaveBeenCalled();
    });

    it('Updates the fields of the account of the user and keeps the others', async () => {
      setupUser([permissions.updateAccount]);

      jest
        .spyOn(accountService, 'account')
        .mockResolvedValue({ userId, id: 'account-id' } as AccountWithBalance);

      await mcpService.updateAccount({
        ...parameters,
        currency: 'CHF',
        platform: 'Bank Y'
      });

      expect(accountService.updateAccount).toHaveBeenCalledWith({
        userId,
        data: {
          currency: 'CHF',
          name: 'New name',
          platform: { connect: { id: 'platform-2' } },
          user: { connect: { id: userId } }
        },
        where: { id_userId: { id: 'account-id', userId } }
      });
    });

    it('Removes the platform with null', async () => {
      setupUser([permissions.updateAccount]);

      jest.spyOn(accountService, 'account').mockResolvedValue({
        userId,
        id: 'account-id',
        platformId: 'platform-1'
      } as AccountWithBalance);

      await mcpService.updateAccount({
        id: 'account-id',
        platform: null,
        userId
      });

      expect(accountService.updateAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ platform: { disconnect: true } })
        })
      );
    });
  });

  describe('updateActivity', () => {
    const originalActivity = {
      accountId: null,
      comment: 'Original comment',
      currency: null,
      date: new Date('2024-01-01'),
      fee: 1,
      id: 'activity-id',
      quantity: 10,
      symbolProfileId: 'symbol-profile-id',
      type: ActivityType.BUY,
      unitPrice: 100,
      userId
    };

    const parameters = { userId, id: 'activity-id', quantity: 12 };

    beforeEach(() => {
      jest
        .spyOn(activitiesService, 'order')
        .mockResolvedValue(originalActivity as never);

      jest.spyOn(activitiesService, 'updateActivity').mockResolvedValue({
        ...originalActivity,
        quantity: 12
      } as never);
    });

    it('Refuses a user without the permission to update an activity', async () => {
      setupUser([]);

      await expect(mcpService.updateActivity(parameters)).rejects.toThrow(
        HttpException
      );

      expect(activitiesService.order).not.toHaveBeenCalled();
      expect(activitiesService.updateActivity).not.toHaveBeenCalled();
    });

    it('Refuses an activity which does not belong to the user', async () => {
      setupUser([permissions.updateActivity]);

      jest.spyOn(activitiesService, 'order').mockResolvedValue(null);

      await expect(mcpService.updateActivity(parameters)).rejects.toThrow(
        CallerFacingError
      );

      expect(activitiesService.order).toHaveBeenCalledWith({
        userId,
        id: 'activity-id'
      });
      expect(activitiesService.updateActivity).not.toHaveBeenCalled();
    });

    it('Refuses an activity which another user owns', async () => {
      setupUser([permissions.updateActivity]);

      jest.spyOn(activitiesService, 'order').mockResolvedValue({
        ...originalActivity,
        userId: 'other-user-id'
      } as never);

      await expect(mcpService.updateActivity(parameters)).rejects.toThrow(
        CallerFacingError
      );

      expect(activitiesService.updateActivity).not.toHaveBeenCalled();
    });

    it('Refuses an account which does not belong to the user', async () => {
      setupUser([permissions.updateActivity]);

      jest.spyOn(accountService, 'account').mockResolvedValue(null);

      await expect(
        mcpService.updateActivity({
          userId,
          accountId: 'other-account-id',
          id: 'activity-id'
        })
      ).rejects.toThrow(CallerFacingError);

      expect(accountService.account).toHaveBeenCalledWith({
        id_userId: { userId, id: 'other-account-id' }
      });
      expect(activitiesService.updateActivity).not.toHaveBeenCalled();
    });

    it('Refuses a call without a field to update', async () => {
      setupUser([permissions.updateActivity]);

      await expect(
        mcpService.updateActivity({ userId, id: 'activity-id' })
      ).rejects.toThrow(CallerFacingError);

      expect(activitiesService.updateActivity).not.toHaveBeenCalled();
    });

    it('Updates the given fields and keeps the others', async () => {
      setupUser([permissions.updateActivity]);

      await mcpService.updateActivity(parameters);

      expect(activitiesService.updateActivity).toHaveBeenCalledWith({
        userId,
        data: {
          account: undefined,
          comment: 'Original comment',
          currency: 'USD',
          date: originalActivity.date,
          fee: 1,
          quantity: 12,
          SymbolProfile: {
            connect: {
              dataSource_symbol: {
                dataSource: DataSource.YAHOO,
                symbol: 'AAPL'
              }
            }
          },
          type: ActivityType.BUY,
          unitPrice: 100,
          user: { connect: { id: userId } }
        },
        originalDate: originalActivity.date,
        where: { id: 'activity-id' }
      });
    });

    it('Connects an account of the user and parses the date', async () => {
      setupUser([permissions.updateActivity]);

      jest
        .spyOn(accountService, 'account')
        .mockResolvedValue({ userId, id: 'account-id' } as AccountWithBalance);

      await mcpService.updateActivity({
        userId,
        accountId: 'account-id',
        date: '2024-02-03',
        id: 'activity-id'
      });

      expect(activitiesService.updateActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            account: { connect: { id_userId: { userId, id: 'account-id' } } },
            date: new Date('2024-02-03')
          })
        })
      );
    });

    it('Disconnects the account with null', async () => {
      setupUser([permissions.updateActivity]);

      await mcpService.updateActivity({
        userId,
        accountId: null,
        id: 'activity-id'
      });

      expect(activitiesService.updateActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ account: { disconnect: true } })
        })
      );
      expect(accountService.account).not.toHaveBeenCalled();
    });

    it('Gives the quantity and the fee only with the values', async () => {
      setupUser([permissions.updateActivity]);

      const withValues = await mcpService.updateActivity({
        ...parameters,
        withValues: true
      });

      const withoutValues = await mcpService.updateActivity(parameters);

      expect(withValues.content[0].text).toContain('Quantity: 12');
      expect(withValues.content[0].text).toContain('Fee: 1');
      expect(withoutValues.content[0].text).not.toContain('Quantity');
      expect(withoutValues.content[0].text).not.toContain('Fee');
    });
  });

  describe('deleteActivity', () => {
    const activity = {
      accountId: null,
      currency: null,
      date: new Date('2024-01-01'),
      fee: 1,
      id: 'activity-id',
      quantity: 10,
      symbolProfileId: 'symbol-profile-id',
      type: ActivityType.BUY,
      unitPrice: 100,
      userId
    };

    beforeEach(() => {
      jest
        .spyOn(activitiesService, 'order')
        .mockResolvedValue(activity as never);
    });

    it('Refuses a user without the permission to delete an activity', async () => {
      setupUser([]);

      await expect(
        mcpService.deleteActivity({ userId, id: 'activity-id' })
      ).rejects.toThrow(HttpException);

      expect(activitiesService.deleteActivity).not.toHaveBeenCalled();
    });

    it('Refuses an activity which does not belong to the user', async () => {
      setupUser([permissions.deleteActivity]);

      jest.spyOn(activitiesService, 'order').mockResolvedValue(null);

      await expect(
        mcpService.deleteActivity({ userId, id: 'activity-id' })
      ).rejects.toThrow(CallerFacingError);

      expect(activitiesService.deleteActivity).not.toHaveBeenCalled();
    });

    it('Deletes the activity of the user', async () => {
      setupUser([permissions.deleteActivity]);

      const result = await mcpService.deleteActivity({
        userId,
        id: 'activity-id'
      });

      expect(activitiesService.deleteActivity).toHaveBeenCalledWith({
        id: 'activity-id'
      });
      expect(result.content[0].text).toContain('Deleted the activity');
    });

    it('Gives the quantity and the fee only with the values', async () => {
      setupUser([permissions.deleteActivity]);

      const withValues = await mcpService.deleteActivity({
        userId,
        id: 'activity-id',
        withValues: true
      });

      const withoutValues = await mcpService.deleteActivity({
        userId,
        id: 'activity-id'
      });

      expect(withValues.content[0].text).toContain('Quantity: 10');
      expect(withoutValues.content[0].text).not.toContain('Quantity');
      expect(withoutValues.content[0].text).not.toContain('Fee');
    });
  });

  describe('gatherMarketData', () => {
    const parameters = {
      userId,
      dataSource: DataSource.YAHOO,
      fullHistory: false,
      symbol: 'AAPL'
    };

    beforeEach(() => {
      setupUser([permissions.createActivity]);
    });

    it('Refuses a user without the permission to create an activity', async () => {
      setupUser([]);

      await expect(mcpService.gatherMarketData(parameters)).rejects.toThrow(
        HttpException
      );

      expect(dataGatheringService.gatherSymbol).not.toHaveBeenCalled();
    });

    it('Refuses an asset profile which is neither in the portfolio nor in the watchlist', async () => {
      jest
        .spyOn(symbolProfileService, 'getSymbolProfileOfUser')
        .mockResolvedValue(null);

      await expect(mcpService.gatherMarketData(parameters)).rejects.toThrow(
        /neither in the portfolio nor in the watchlist/
      );

      expect(symbolProfileService.getSymbolProfileOfUser).toHaveBeenCalledWith({
        userId,
        dataSource: DataSource.YAHOO,
        symbol: 'AAPL'
      });
      expect(dataGatheringService.gatherSymbol).not.toHaveBeenCalled();
    });

    it('Refuses an inactive asset profile', async () => {
      jest
        .spyOn(symbolProfileService, 'getSymbolProfileOfUser')
        .mockResolvedValue({
          currency: 'USD',
          dataSource: DataSource.YAHOO,
          isActive: false,
          scraperConfiguration: null,
          symbol: 'AAPL'
        });

      await expect(mcpService.gatherMarketData(parameters)).rejects.toThrow(
        CallerFacingError
      );

      expect(dataGatheringService.gatherSymbol).not.toHaveBeenCalled();
    });

    it('Refuses a manual asset profile without a scraper configuration', async () => {
      jest
        .spyOn(symbolProfileService, 'getSymbolProfileOfUser')
        .mockResolvedValue({
          currency: 'USD',
          dataSource: DataSource.MANUAL,
          isActive: true,
          scraperConfiguration: null,
          symbol: 'AAPL'
        });

      await expect(
        mcpService.gatherMarketData({
          ...parameters,
          dataSource: DataSource.MANUAL
        })
      ).rejects.toThrow(CallerFacingError);

      expect(dataGatheringService.gatherSymbol).not.toHaveBeenCalled();
    });

    it('Queues the gathering of the last 30 days', async () => {
      const result = await mcpService.gatherMarketData(parameters);

      const { date, ...rest } = (dataGatheringService.gatherSymbol as jest.Mock)
        .mock.calls[0][0] as { date: Date };

      expect(rest).toEqual({ dataSource: DataSource.YAHOO, symbol: 'AAPL' });
      expect(date.getTime()).toBeLessThan(
        Date.now() - 29 * 24 * 60 * 60 * 1000
      );
      expect(result.content[0].text).toContain('1 job(s)');
    });

    it('Queues the gathering of the full history', async () => {
      await mcpService.gatherMarketData({ ...parameters, fullHistory: true });

      expect(dataGatheringService.gatherSymbol).toHaveBeenCalledWith({
        dataSource: DataSource.YAHOO,
        date: undefined,
        symbol: 'AAPL'
      });
    });

    it('Refuses a second gathering of the same asset profile in the interval', async () => {
      await mcpService.gatherMarketData(parameters);

      await expect(mcpService.gatherMarketData(parameters)).rejects.toThrow(
        /15 minutes/
      );

      expect(dataGatheringService.gatherSymbol).toHaveBeenCalledTimes(1);
      expect(redisCacheService.set).toHaveBeenCalledWith(
        `mcp-gather-market-data-${userId}-YAHOO-AAPL`,
        expect.any(String),
        GATHER_MARKET_DATA_INTERVAL
      );
    });

    it('Allows a gathering of another asset profile in the interval', async () => {
      await mcpService.gatherMarketData(parameters);
      await mcpService.gatherMarketData({ ...parameters, symbol: 'MSFT' });

      expect(dataGatheringService.gatherSymbol).toHaveBeenCalledTimes(2);
    });

    it('Releases the interval if nothing was queued', async () => {
      (dataGatheringService.gatherSymbol as jest.Mock).mockResolvedValueOnce(
        []
      );

      await expect(mcpService.gatherMarketData(parameters)).rejects.toThrow(
        CallerFacingError
      );

      await expect(mcpService.gatherMarketData(parameters)).resolves.toEqual(
        expect.anything()
      );
    });

    it('Gives what was queued and no monetary value', async () => {
      const result = await mcpService.gatherMarketData(parameters);

      expect(result.content[0].text).not.toMatch(
        /balance|quantity|\d+\.\d{2}/i
      );
    });
  });

  describe('getMarketData', () => {
    const parameters = {
      userId,
      dataSource: DataSource.YAHOO,
      range: 'max',
      symbol: 'AAPL'
    };

    function getMarketDataOfDays(numberOfDays: number) {
      return Array.from({ length: numberOfDays }, (_, index) => {
        return {
          date: new Date(Date.UTC(2020, 0, 1 + index)),
          marketPrice: 100 + index
        };
      });
    }

    it('Refuses an asset profile which is neither in the portfolio nor in the watchlist', async () => {
      jest
        .spyOn(symbolProfileService, 'getSymbolProfileOfUser')
        .mockResolvedValue(null);

      await expect(mcpService.getMarketData(parameters)).rejects.toThrow(
        CallerFacingError
      );

      expect(marketDataService.getRange).not.toHaveBeenCalled();
    });

    it('Reads the market data of the database in the date range', async () => {
      const marketData = getMarketDataOfDays(3);

      jest
        .spyOn(marketDataService, 'getRange')
        .mockResolvedValue(marketData as never);

      const result = await mcpService.getMarketData(parameters);

      expect(marketDataService.getRange).toHaveBeenCalledWith({
        assetProfileIdentifiers: [
          { dataSource: DataSource.YAHOO, symbol: 'AAPL' }
        ],
        dateQuery: { gte: expect.any(Date), lt: expect.any(Date) }
      });
      expect(portfolioTableService.getMarketDataTable).toHaveBeenCalledWith({
        marketData,
        currency: 'USD',
        numberOfMarketPrices: 3,
        sampling: undefined
      });
      expect(result.content[0].text).toBe('## Market Data');
    });

    it('Samples a long range weekly', async () => {
      jest
        .spyOn(marketDataService, 'getRange')
        .mockResolvedValue(getMarketDataOfDays(700) as never);

      await mcpService.getMarketData(parameters);

      const { marketData, numberOfMarketPrices, sampling } = (
        portfolioTableService.getMarketDataTable as jest.Mock
      ).mock.calls[0][0] as {
        marketData: { date: Date }[];
        numberOfMarketPrices: number;
        sampling: string;
      };

      expect(sampling).toBe('weekly');
      expect(numberOfMarketPrices).toBe(700);
      expect(marketData.length).toBeLessThanOrEqual(MARKET_DATA_MAX_POINTS);
      expect(marketData.length).toBeGreaterThan(90);
    });

    it('Samples a very long range monthly', async () => {
      jest
        .spyOn(marketDataService, 'getRange')
        .mockResolvedValue(getMarketDataOfDays(6000) as never);

      await mcpService.getMarketData(parameters);

      const { marketData, sampling } = (
        portfolioTableService.getMarketDataTable as jest.Mock
      ).mock.calls[0][0] as { marketData: unknown[]; sampling: string };

      expect(sampling).toBe('monthly');
      expect(marketData.length).toBeLessThanOrEqual(MARKET_DATA_MAX_POINTS);
    });
  });

  describe('getNotificationStatus', () => {
    it('Gives the number of the subscribed devices and the configuration', async () => {
      const result = await mcpService.getNotificationStatus({ userId });

      expect(pushService.getSubscriptionCount).toHaveBeenCalledWith({
        userId
      });
      expect(result.content[0].text).toContain('Subscribed devices: 2');
      expect(result.content[0].text).toContain('(VAPID keys): yes');
    });

    it('Explains how to subscribe a device if there is none', async () => {
      (pushService.getSubscriptionCount as jest.Mock).mockResolvedValue(0);

      const result = await mcpService.getNotificationStatus({ userId });

      expect(result.content[0].text).toContain('Subscribed devices: 0');
      expect(result.content[0].text).toContain('enable the notifications');
    });

    it('Tells that the keys are missing', async () => {
      (pushService.isConfigured as jest.Mock).mockReturnValue(false);

      const result = await mcpService.getNotificationStatus({ userId });

      expect(result.content[0].text).toContain('(VAPID keys): no');
    });

    it('Never gives the endpoint or the keys of a device', async () => {
      const result = await mcpService.getNotificationStatus({ userId });

      expect(result.content[0].text).not.toMatch(/endpoint|p256dh|auth/i);
    });
  });

  describe('reports', () => {
    it('Gives the open decisions of the user', async () => {
      await mcpService.getOpenDecisions({ userId });

      expect(reportsService.getDecisions).toHaveBeenCalledWith({
        status: 'OPEN',
        userId
      });
    });

    it('Gives the answers since a date', async () => {
      await mcpService.getDecisionAnswers({
        userId,
        since: '2026-11-01T00:00:00Z'
      });

      expect(reportsService.getDecisions).toHaveBeenCalledWith({
        status: 'DECIDED',
        userId,
        since: new Date('2026-11-01T00:00:00Z')
      });
    });

    it('Publishes a report with a decision if the role permits', async () => {
      setupUser([permissions.createReport]);

      const parameters = {
        decisions: [
          {
            options: [{ id: 'a', label: 'Buy' }],
            question: 'Buy?'
          }
        ],
        kind: 'BRIEF' as const,
        summary: 'Summary',
        title: 'Title'
      };

      await mcpService.publishReport({ ...parameters, userId });

      expect(reportsService.createReport).toHaveBeenCalledWith({
        userId,
        data: parameters
      });
    });

    it('Refuses to publish a report without the permission', async () => {
      setupUser([]);

      await expect(
        mcpService.publishReport({
          kind: 'BRIEF',
          summary: 'Summary',
          title: 'Title',
          userId
        })
      ).rejects.toBeInstanceOf(HttpException);

      expect(reportsService.createReport).not.toHaveBeenCalled();
    });

    it('Refuses the tools of reports while the feature is disabled', async () => {
      configuration.ENABLE_FEATURE_REPORTS = false;

      await expect(mcpService.getOpenDecisions({ userId })).rejects.toThrow(
        CallerFacingError
      );
    });

    it('Reopens or dismisses a decision of the report', async () => {
      setupUser([permissions.updateReport]);

      await mcpService.updateReport({
        id: 'report-id',
        userId,
        decisions: [{ id: 'decision-id', status: 'DISMISSED' }],
        title: 'New title'
      });

      expect(reportsService.setDecisionStatus).toHaveBeenCalledWith({
        id: 'decision-id',
        status: 'DISMISSED',
        userId
      });
    });

    it('Refuses a decision which belongs to another report', async () => {
      setupUser([permissions.updateReport]);

      await expect(
        mcpService.updateReport({
          id: 'report-id',
          userId,
          decisions: [{ id: 'other-decision', status: 'OPEN' }]
        })
      ).rejects.toThrow(CallerFacingError);

      expect(reportsService.setDecisionStatus).not.toHaveBeenCalled();
    });

    it('Sends a notification', async () => {
      const result = await mcpService.sendNotification({
        body: 'Body',
        title: 'Title',
        userId
      });

      expect(pushService.sendToUser).toHaveBeenCalledWith({
        userId,
        notification: { body: 'Body', title: 'Title', url: undefined }
      });
      expect(result.content[0].text).toBe(
        'Sent the notification to 2 device(s)'
      );
    });

    it('Explains how to subscribe a device if the notification reached none', async () => {
      (pushService.sendToUser as jest.Mock).mockResolvedValue(0);

      const result = await mcpService.sendNotification({
        body: 'Body',
        title: 'Title',
        userId
      });

      expect(result.content[0].text).toContain('0 device(s)');
      expect(result.content[0].text).toContain('enable the notifications');
    });

    it('Refuses to send a notification without the configuration', async () => {
      (pushService.isConfigured as jest.Mock).mockReturnValue(false);

      await expect(
        mcpService.sendNotification({ body: 'Body', title: 'Title', userId })
      ).rejects.toThrow(CallerFacingError);
    });
  });
});
