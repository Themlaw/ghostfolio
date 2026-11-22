import { HasPermission } from '@ghostfolio/api/decorators/has-permission.decorator';
import { Impersonation } from '@ghostfolio/api/decorators/impersonation.decorator';
import { RequiresScope } from '@ghostfolio/api/decorators/requires-scope.decorator';
import {
  AnswerDecisionDto,
  CreateReportDto,
  UpdateReportDto
} from '@ghostfolio/common/dtos';
import { permissions } from '@ghostfolio/common/permissions';
import { scopes } from '@ghostfolio/common/scopes';
import type { ImpersonationContext } from '@ghostfolio/common/types';

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards
} from '@nestjs/common';
import { DecisionStatus, ReportKind } from '@prisma/client';
import { StatusCodes } from 'http-status-codes';

import { ReportsFeatureGuard } from './reports-feature.guard';
import { ReportsService } from './reports.service';

@Controller()
@UseGuards(ReportsFeatureGuard)
export class ReportsController {
  public constructor(private readonly reportsService: ReportsService) {}

  @HasPermission(permissions.createReport)
  @Post('reports')
  @RequiresScope(scopes.reportCreate)
  public async createReport(
    @Body() data: CreateReportDto,
    @Impersonation() { userId }: ImpersonationContext
  ) {
    return this.reportsService.createReport({ data, userId });
  }

  @Delete('reports/:id')
  @HasPermission(permissions.deleteReport)
  @HttpCode(StatusCodes.NO_CONTENT)
  @RequiresScope(scopes.reportUpdate)
  public async deleteReport(
    @Impersonation() { userId }: ImpersonationContext,
    @Param('id', ParseUUIDPipe) id: string
  ) {
    if (!(await this.reportsService.deleteReport({ id, userId }))) {
      throw new NotFoundException();
    }
  }

  @Get('decisions')
  @HasPermission(permissions.readReport)
  @RequiresScope(scopes.reportRead)
  public async getDecisions(
    @Impersonation() { userId }: ImpersonationContext,
    @Query('since') since?: string,
    @Query('status') status?: DecisionStatus
  ) {
    if (status && !Object.values(DecisionStatus).includes(status)) {
      throw new BadRequestException('Invalid status');
    }

    if (since && Number.isNaN(new Date(since).getTime())) {
      throw new BadRequestException('Invalid date');
    }

    return {
      decisions: await this.reportsService.getDecisions({
        status,
        userId,
        since: since ? new Date(since) : undefined
      })
    };
  }

  @Get('reports/:id')
  @HasPermission(permissions.readReport)
  @RequiresScope(scopes.reportRead)
  public async getReport(
    @Impersonation() { userId }: ImpersonationContext,
    @Param('id', ParseUUIDPipe) id: string
  ) {
    const report = await this.reportsService.getReport({ id, userId });

    if (!report) {
      throw new NotFoundException();
    }

    return report;
  }

  @Get('reports')
  @HasPermission(permissions.readReport)
  @RequiresScope(scopes.reportRead)
  public async getReports(
    @Impersonation() { userId }: ImpersonationContext,
    @Query('kind') kind?: ReportKind,
    @Query('q') q?: string,
    @Query('skip') skip?: string,
    @Query('subject') subject?: string,
    @Query('take') take?: string
  ) {
    if (kind && !Object.values(ReportKind).includes(kind)) {
      throw new BadRequestException('Invalid kind');
    }

    return this.reportsService.getReports({
      kind,
      subject,
      userId,
      q: q?.slice(0, 255),
      skip: skip ? Number.parseInt(skip, 10) || 0 : undefined,
      take: take ? Number.parseInt(take, 10) || undefined : undefined
    });
  }

  @HasPermission(permissions.updateReport)
  @Post('decisions/:id/answer')
  @RequiresScope(scopes.reportUpdate)
  public async answerDecision(
    @Body() { optionId, text }: AnswerDecisionDto,
    @Impersonation() { userId }: ImpersonationContext,
    @Param('id', ParseUUIDPipe) id: string
  ) {
    const decision = await this.reportsService.answerDecision({
      id,
      optionId,
      text,
      userId
    });

    if (!decision) {
      throw new NotFoundException();
    }

    return decision;
  }

  @HasPermission(permissions.updateReport)
  @Patch('decisions/:id')
  @RequiresScope(scopes.reportUpdate)
  public async reopenOrDismissDecision(
    @Body('status') status: string,
    @Impersonation() { userId }: ImpersonationContext,
    @Param('id', ParseUUIDPipe) id: string
  ) {
    if (status !== DecisionStatus.OPEN && status !== DecisionStatus.DISMISSED) {
      throw new BadRequestException('The status has to be OPEN or DISMISSED');
    }

    const decision = await this.reportsService.setDecisionStatus({
      id,
      status,
      userId
    });

    if (!decision) {
      throw new NotFoundException();
    }

    return decision;
  }

  @HasPermission(permissions.updateReport)
  @Patch('reports/:id')
  @RequiresScope(scopes.reportUpdate)
  public async updateReport(
    @Body() data: UpdateReportDto,
    @Impersonation() { userId }: ImpersonationContext,
    @Param('id', ParseUUIDPipe) id: string
  ) {
    const report = await this.reportsService.updateReport({ data, id, userId });

    if (!report) {
      throw new NotFoundException();
    }

    return report;
  }
}
