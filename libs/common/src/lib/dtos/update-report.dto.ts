import { ReportKind } from '@ghostfolio/prisma/enums';

import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested
} from 'class-validator';

import {
  ReportConceptDto,
  ReportPointDto,
  ReportSourceDto
} from './create-report.dto';

/**
 * Updates the content of a report. An omitted field stays as it is. To answer a
 * decision of the report, use the answer of the decision.
 */
export class UpdateReportDto {
  @IsObject()
  @IsOptional()
  charts?: Record<string, unknown>;

  @IsArray()
  @ArrayMaxSize(50)
  @IsOptional()
  @Type(() => ReportConceptDto)
  @ValidateNested({ each: true })
  concepts?: ReportConceptDto[];

  @IsOptional()
  @IsString()
  @MaxLength(100000)
  details?: string;

  @IsEnum(ReportKind)
  @IsOptional()
  kind?: ReportKind;

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

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  summary?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  @MinLength(1)
  title?: string;
}
