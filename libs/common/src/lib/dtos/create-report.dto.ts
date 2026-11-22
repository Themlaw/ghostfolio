import { ReportKind } from '@ghostfolio/prisma/enums';

import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  ValidateNested
} from 'class-validator';

export const REPORT_POINT_LEVELS = ['important', 'note', 'info'] as const;

export type ReportPointLevel = (typeof REPORT_POINT_LEVELS)[number];

export class ReportPointDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  forYou?: string;

  @IsIn(REPORT_POINT_LEVELS)
  level: ReportPointLevel;

  @IsString()
  @MaxLength(200)
  subject: string;

  @IsString()
  @MaxLength(4000)
  text: string;
}

export class ReportConceptDto {
  @IsString()
  @MaxLength(4000)
  definition: string;

  @IsString()
  @MaxLength(4000)
  example: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  forYou?: string;

  @IsString()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  theme?: string;
}

export class ReportSourceDto {
  @IsOptional()
  @IsISO8601()
  date?: string;

  @IsString()
  @MaxLength(500)
  title: string;

  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2000)
  url: string;
}

export class DecisionOptionDto {
  @IsString()
  @MaxLength(100)
  @MinLength(1)
  id: string;

  @IsString()
  @MaxLength(500)
  @MinLength(1)
  label: string;
}

export class CreateDecisionDto {
  @IsArray()
  @ArrayMaxSize(10)
  @IsOptional()
  @Type(() => DecisionOptionDto)
  @ValidateNested({ each: true })
  options?: DecisionOptionDto[];

  @IsString()
  @MaxLength(2000)
  @MinLength(1)
  question: string;
}

export class CreateReportDto {
  @IsObject()
  @IsOptional()
  charts?: Record<string, unknown>;

  @IsArray()
  @ArrayMaxSize(50)
  @IsOptional()
  @Type(() => ReportConceptDto)
  @ValidateNested({ each: true })
  concepts?: ReportConceptDto[];

  @IsArray()
  @ArrayMaxSize(10)
  @IsOptional()
  @Type(() => CreateDecisionDto)
  @ValidateNested({ each: true })
  decisions?: CreateDecisionDto[];

  @IsOptional()
  @IsString()
  @MaxLength(100000)
  details?: string;

  @IsEnum(ReportKind)
  kind: ReportKind;

  @IsArray()
  @ArrayMaxSize(100)
  @IsOptional()
  @Type(() => ReportPointDto)
  @ValidateNested({ each: true })
  points?: ReportPointDto[];

  @IsISO8601()
  @IsOptional()
  publishedAt?: string;

  @IsArray()
  @ArrayMaxSize(50)
  @IsOptional()
  @Type(() => ReportSourceDto)
  @ValidateNested({ each: true })
  sources?: ReportSourceDto[];

  @IsArray()
  @ArrayMaxSize(50)
  @IsOptional()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  subjects?: string[];

  @IsString()
  @MaxLength(5000)
  summary: string;

  @IsString()
  @MaxLength(300)
  @MinLength(1)
  title: string;
}
