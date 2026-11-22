import { DATE_RANGE_PATTERN } from '@ghostfolio/api/dtos/date-range-filter.dto';
import { isValidEncodedDataSource } from '@ghostfolio/api/helper/data-source.helper';
import {
  COMMENT_MAXIMUM_LENGTH,
  DATE_RANGES,
  DEFAULT_DATE_RANGE,
  MCP_MAX_ACCOUNTS,
  MCP_MAX_ACTIVITIES,
  SEARCH_QUERY_MAXIMUM_LENGTH,
  SEARCH_QUERY_MINIMUM_LENGTH,
  SYMBOL_MAXIMUM_LENGTH
} from '@ghostfolio/common/config';
import {
  isValidAccountBalanceDate,
  isValidCurrencyCode,
  isValidDateAfter1970
} from '@ghostfolio/common/helper';

import { AssetClass, DataSource, Type as ActivityType } from '@prisma/client';
import { z } from 'zod';

const DATA_SOURCE_PARAMETER_ERROR = `Invalid option: expected one of ${Object.values(DataSource).join('|')} or a data source as given by a tool`;

const DATA_SOURCE_PARAMETER = z
  .union(
    [
      z.enum(DataSource),
      z.string().refine(isValidEncodedDataSource, {
        error: DATA_SOURCE_PARAMETER_ERROR
      })
    ],
    { error: DATA_SOURCE_PARAMETER_ERROR }
  )
  .describe('The data source of the asset profile');

const SYMBOL_PARAMETER = z
  .string()
  .trim()
  .min(1)
  .max(SYMBOL_MAXIMUM_LENGTH)
  .describe('The symbol of the asset profile');

const HOLDING_PARAMETER = z.object({
  dataSource: DATA_SOURCE_PARAMETER,
  symbol: SYMBOL_PARAMETER
});

export const GET_ACCOUNTS_PARAMETERS = z.object({
  accountIds: z
    .array(z.string().min(1))
    .min(1)
    .max(MCP_MAX_ACCOUNTS)
    .optional()
    .describe(
      `The identifiers of the accounts to get, at most ${MCP_MAX_ACCOUNTS}`
    ),
  assetClasses: z
    .array(z.enum(AssetClass))
    .min(1)
    .optional()
    .describe('The asset classes of the accounts to get'),
  holding: HOLDING_PARAMETER.optional().describe(
    'The asset profile of the accounts to get'
  )
});

export const GET_ACTIVITIES_PARAMETERS = z.object({
  activityTypes: z
    .array(z.enum(ActivityType))
    .min(1)
    .optional()
    .describe('The types of the activities to get'),
  assetClasses: z
    .array(z.enum(AssetClass))
    .min(1)
    .optional()
    .describe('The asset classes of the activities to get'),
  holding: HOLDING_PARAMETER.optional().describe(
    'The asset profile of the activities to get'
  ),
  range: z
    .string()
    .regex(DATE_RANGE_PATTERN)
    .optional()
    .describe(
      `The date range of the activities to get, either ${DATE_RANGES.join(
        ', '
      )} or a calendar year like 2024`
    ),
  skip: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('The number of activities to skip'),
  take: z
    .number()
    .int()
    .min(1)
    .max(MCP_MAX_ACTIVITIES)
    .default(MCP_MAX_ACTIVITIES)
    .describe(`The number of activities to get, at most ${MCP_MAX_ACTIVITIES}`)
});

export const GET_PERFORMANCE_PARAMETERS = z.object({
  accountIds: z
    .array(z.string().min(1))
    .min(1)
    .max(MCP_MAX_ACCOUNTS)
    .optional()
    .describe(
      `The identifiers of the accounts of the performance, at most ${MCP_MAX_ACCOUNTS}`
    ),
  assetClasses: z
    .array(z.enum(AssetClass))
    .min(1)
    .optional()
    .describe('The asset classes of the performance'),
  holding: HOLDING_PARAMETER.optional().describe(
    'The asset profile of the performance'
  ),
  range: z
    .string()
    .regex(DATE_RANGE_PATTERN)
    .default(DEFAULT_DATE_RANGE)
    .describe(
      `The date range of the performance, either ${DATE_RANGES.join(
        ', '
      )} or a calendar year like 2024`
    )
});

export const IMPORT_ACTIVITIES_PARAMETERS = z.object({
  activities: z
    .array(
      z.object({
        accountId: z
          .string()
          .min(1)
          .optional()
          .describe('The identifier of the account of the activity'),
        comment: z
          .string()
          .trim()
          .max(COMMENT_MAXIMUM_LENGTH)
          .optional()
          .describe('The comment of the activity'),
        currency: z
          .string()
          .refine(isValidCurrencyCode)
          .describe(
            'The currency of the fee and of the unit price, as an ISO 4217 code in upper case'
          ),
        dataSource: DATA_SOURCE_PARAMETER.optional(),
        date: z
          .string()
          .refine(isValidDateAfter1970)
          .describe(
            'The date of the activity, as an ISO 8601 date or date and time'
          ),
        fee: z.number().min(0).describe('The fee of the activity'),
        quantity: z.number().min(0).describe('The quantity of the activity'),
        symbol: SYMBOL_PARAMETER,
        type: z.enum(ActivityType).describe('The type of the activity'),
        unitPrice: z.number().min(0).describe('The unit price of the activity')
      })
    )
    .min(1)
    .max(MCP_MAX_ACTIVITIES)
    .describe(`The activities to import, at most ${MCP_MAX_ACTIVITIES}`)
});

export const SEARCH_ASSET_PROFILES_PARAMETERS = z.object({
  query: z
    .string()
    .trim()
    .min(SEARCH_QUERY_MINIMUM_LENGTH)
    .max(SEARCH_QUERY_MAXIMUM_LENGTH)
    .describe(
      'The name, ticker symbol or ISIN of the financial asset, for example Apple, AAPL, Bitcoin or US0378331005'
    )
});

export const UPDATE_ACCOUNT_BALANCE_PARAMETERS = z.object({
  accountId: z.string().min(1).describe('The identifier of the account'),
  balance: z
    .number()
    .describe('The cash balance of the account in the currency of the account'),
  date: z.iso
    .date({
      abort: true,
      error: 'The date must be an ISO 8601 date, for example 2024-01-01'
    })
    .refine(isValidDateAfter1970, {
      error: 'The date must be after 1970-01-01'
    })
    .refine(isValidAccountBalanceDate, {
      error: 'The date must not be in the future'
    })
    .describe('The date of the cash balance, as an ISO 8601 date')
});

const REPORT_KINDS = [
  'ALLOCATION',
  'ANALYSIS',
  'BRIEF',
  'LESSON',
  'REVIEW'
] as const;

const REPORT_POINT_PARAMETERS = z.object({
  forYou: z
    .string()
    .max(2000)
    .optional()
    .describe('What the point means for the user in particular'),
  level: z
    .enum(['important', 'note', 'info'])
    .describe('The importance of the point'),
  subject: z
    .string()
    .min(1)
    .max(200)
    .describe('The subject of the point, e.g. a holding or a theme'),
  text: z.string().min(1).max(4000).describe('The text of the point')
});

const REPORT_CONCEPT_PARAMETERS = z.object({
  definition: z.string().min(1).max(4000),
  example: z.string().min(1).max(4000),
  forYou: z.string().max(2000).optional(),
  name: z.string().min(1).max(200),
  theme: z.string().max(200).optional()
});

const REPORT_SOURCE_PARAMETERS = z.object({
  date: z.iso.date().optional().describe('The date of the source'),
  title: z.string().min(1).max(500),
  url: z.url({ protocol: /^https?$/ }).max(2000)
});

const REPORT_DECISION_PARAMETERS = z.object({
  options: z
    .array(
      z.object({
        id: z.string().min(1).max(100).describe('The identifier of the option'),
        label: z.string().min(1).max(500).describe('The text of the option')
      })
    )
    .max(10)
    .optional()
    .describe(
      'The options which the user can choose. Without options, the user answers with a text.'
    ),
  question: z.string().min(1).max(2000).describe('The question to decide')
});

const REPORT_ID_PARAMETER = z
  .string()
  .min(1)
  .max(100)
  .describe('The identifier of the report');

export const GET_DECISION_ANSWERS_PARAMETERS = z.object({
  since: z.iso
    .datetime({ offset: true })
    .optional()
    .describe(
      'Only the decisions which the user decided at or after this date and time, as an ISO 8601 date and time, e.g. 2026-11-01T00:00:00Z'
    )
});

export const GET_REPORT_PARAMETERS = z.object({ id: REPORT_ID_PARAMETER });

export const GET_REPORTS_PARAMETERS = z.object({
  kind: z.enum(REPORT_KINDS).optional().describe('The kind of the reports'),
  q: z
    .string()
    .trim()
    .min(1)
    .max(SEARCH_QUERY_MAXIMUM_LENGTH)
    .optional()
    .describe('Text which the title, the summary or the details contain'),
  skip: z.number().int().min(0).optional(),
  subject: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('A subject which the reports name'),
  take: z.number().int().min(1).max(20).optional()
});

export const PUBLISH_REPORT_PARAMETERS = z.object({
  charts: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Data of charts which the application renders'),
  concepts: z.array(REPORT_CONCEPT_PARAMETERS).max(50).optional(),
  decisions: z
    .array(REPORT_DECISION_PARAMETERS)
    .max(10)
    .optional()
    .describe('Questions which the user decides in the application'),
  details: z
    .string()
    .max(100000)
    .optional()
    .describe('The details of the report, as markdown'),
  kind: z.enum(REPORT_KINDS).describe('The kind of the report'),
  points: z.array(REPORT_POINT_PARAMETERS).max(100).optional(),
  publishedAt: z.iso
    .datetime({ offset: true })
    .optional()
    .describe('The date and time of the publication, default: now'),
  sources: z.array(REPORT_SOURCE_PARAMETERS).max(50).optional(),
  subjects: z
    .array(z.string().min(1).max(200))
    .max(50)
    .optional()
    .describe('The subjects of the report, e.g. symbols or themes'),
  summary: z.string().min(1).max(5000).describe('The summary of the report'),
  title: z.string().min(1).max(300).describe('The title of the report')
});

export const SEND_NOTIFICATION_PARAMETERS = z.object({
  body: z.string().min(1).max(500).describe('The text of the notification'),
  title: z.string().min(1).max(100).describe('The title of the notification'),
  url: z
    .string()
    .max(2000)
    .refine(
      (value) => {
        return (
          (value.startsWith('/') && !value.startsWith('//')) ||
          value.startsWith('https://')
        );
      },
      { error: 'The URL must be a path of the application or a HTTPS URL' }
    )
    .optional()
    .describe('The path or the URL which the notification opens')
});

export const UPDATE_REPORT_PARAMETERS = z.object({
  charts: z.record(z.string(), z.unknown()).optional(),
  concepts: z.array(REPORT_CONCEPT_PARAMETERS).max(50).optional(),
  decisions: z
    .array(
      z.object({
        id: z
          .string()
          .min(1)
          .max(100)
          .describe('The identifier of the decision'),
        status: z
          .enum(['OPEN', 'DISMISSED'])
          .describe(
            'OPEN reopens the decision and removes its answer, DISMISSED withdraws it. Only the user decides a decision.'
          )
      })
    )
    .max(10)
    .optional()
    .describe('Changes of the status of decisions of the report'),
  details: z.string().max(100000).optional(),
  id: REPORT_ID_PARAMETER,
  kind: z.enum(REPORT_KINDS).optional(),
  points: z.array(REPORT_POINT_PARAMETERS).max(100).optional(),
  sources: z.array(REPORT_SOURCE_PARAMETERS).max(50).optional(),
  subjects: z.array(z.string().min(1).max(200)).max(50).optional(),
  summary: z.string().min(1).max(5000).optional(),
  title: z.string().min(1).max(300).optional()
});
