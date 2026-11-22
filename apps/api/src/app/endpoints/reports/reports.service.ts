import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import { CreateReportDto, UpdateReportDto } from '@ghostfolio/common/dtos';

import { BadRequestException, Injectable } from '@nestjs/common';
import { DecisionStatus, Prisma, ReportKind } from '@prisma/client';

import { PushService } from '../push/push.service';

export const REPORTS_MAX_TAKE = 50;

@Injectable()
export class ReportsService {
  public constructor(
    private readonly prismaService: PrismaService,
    private readonly pushService: PushService
  ) {}

  public async answerDecision({
    id,
    optionId,
    text,
    userId
  }: {
    id: string;
    optionId?: string;
    text?: string;
    userId: string;
  }) {
    const answerText = text?.trim() || undefined;

    if (!optionId && !answerText) {
      throw new BadRequestException('An option or a text is required');
    }

    const decision = await this.prismaService.decision.findFirst({
      where: { id, userId }
    });

    if (!decision) {
      return null;
    }

    const options = (decision.options ?? []) as { id: string }[];

    if (
      optionId &&
      !options.some(({ id: idOfOption }) => idOfOption === optionId)
    ) {
      throw new BadRequestException(
        'The option does not belong to the decision'
      );
    }

    return this.prismaService.decision.update({
      data: {
        answerOptionId: optionId ?? null,
        answerText: answerText ?? null,
        decidedAt: new Date(),
        status: DecisionStatus.DECIDED
      },
      where: { id }
    });
  }

  public async createReport({
    data,
    userId
  }: {
    data: CreateReportDto;
    userId: string;
  }) {
    const report = await this.prismaService.report.create({
      data: {
        userId,
        charts: data.charts as Prisma.InputJsonValue | undefined,
        concepts: (data.concepts ?? []) as unknown as Prisma.InputJsonValue,
        decisions: {
          create: (data.decisions ?? []).map(({ options, question }) => {
            return {
              question,
              userId,
              options: (options ?? []) as unknown as Prisma.InputJsonValue
            };
          })
        },
        details: data.details,
        kind: data.kind,
        points: (data.points ?? []) as unknown as Prisma.InputJsonValue,
        publishedAt: data.publishedAt ? new Date(data.publishedAt) : undefined,
        sources: (data.sources ?? []) as unknown as Prisma.InputJsonValue,
        subjects: data.subjects ?? [],
        summary: data.summary,
        title: data.title
      },
      include: { decisions: true }
    });

    const hasImportantPoint = (data.points ?? []).some(({ level }) => {
      return level === 'important';
    });

    if (hasImportantPoint || report.decisions.length > 0) {
      await this.pushService.sendToUser({
        userId,
        notification: {
          body: report.summary.slice(0, 200),
          title:
            report.decisions.length > 0
              ? `Decision needed: ${report.title}`
              : report.title,
          url: `/home/reports/${report.id}`
        }
      });
    }

    return report;
  }

  public async deleteReport({ id, userId }: { id: string; userId: string }) {
    const { count } = await this.prismaService.report.deleteMany({
      where: { id, userId }
    });

    return count > 0;
  }

  /**
   * Gives the decisions of the user. The date narrows the decisions which the
   * user decided since then, hence the next report reads the recent answers.
   */
  public async getDecisions({
    since,
    status,
    userId
  }: {
    since?: Date;
    status?: DecisionStatus;
    userId: string;
  }) {
    return this.prismaService.decision.findMany({
      include: {
        report: { select: { id: true, subjects: true, title: true } }
      },
      orderBy: [{ decidedAt: 'desc' }, { createdAt: 'desc' }],
      take: 200,
      where: {
        userId,
        decidedAt: since ? { gte: since } : undefined,
        status
      }
    });
  }

  public async getReport({ id, userId }: { id: string; userId: string }) {
    return this.prismaService.report.findFirst({
      include: { decisions: { orderBy: { createdAt: 'asc' } } },
      where: { id, userId }
    });
  }

  public async getReports({
    kind,
    q,
    skip = 0,
    subject,
    take = 20,
    userId
  }: {
    kind?: ReportKind;
    q?: string;
    skip?: number;
    subject?: string;
    take?: number;
    userId: string;
  }) {
    const where: Prisma.ReportWhereInput = {
      kind,
      userId,
      OR: q
        ? [
            { summary: { contains: q, mode: 'insensitive' } },
            { title: { contains: q, mode: 'insensitive' } },
            { details: { contains: q, mode: 'insensitive' } }
          ]
        : undefined,
      subjects: subject ? { has: subject } : undefined
    };

    const [count, reports] = await Promise.all([
      this.prismaService.report.count({ where }),
      this.prismaService.report.findMany({
        include: { decisions: true },
        orderBy: { publishedAt: 'desc' },
        skip: Math.max(skip, 0),
        take: Math.min(Math.max(take, 1), REPORTS_MAX_TAKE),
        where
      })
    ]);

    return { count, reports };
  }

  /**
   * Changes the status of a decision to open or to dismissed. Only the answer
   * of the user decides a decision.
   */
  public async setDecisionStatus({
    id,
    status,
    userId
  }: {
    id: string;
    status: typeof DecisionStatus.OPEN | typeof DecisionStatus.DISMISSED;
    userId: string;
  }) {
    const { count } = await this.prismaService.decision.updateMany({
      data:
        status === DecisionStatus.OPEN
          ? {
              answerOptionId: null,
              answerText: null,
              decidedAt: null,
              status
            }
          : { decidedAt: new Date(), status },
      where: { id, userId }
    });

    return count > 0
      ? this.prismaService.decision.findFirst({ where: { id, userId } })
      : null;
  }

  public async updateReport({
    data,
    id,
    userId
  }: {
    data: UpdateReportDto;
    id: string;
    userId: string;
  }) {
    const { count } = await this.prismaService.report.updateMany({
      data: {
        charts: data.charts as Prisma.InputJsonValue | undefined,
        concepts: data.concepts as unknown as Prisma.InputJsonValue | undefined,
        details: data.details,
        kind: data.kind,
        points: data.points as unknown as Prisma.InputJsonValue | undefined,
        publishedAt: data.publishedAt ? new Date(data.publishedAt) : undefined,
        sources: data.sources as unknown as Prisma.InputJsonValue | undefined,
        subjects: data.subjects,
        summary: data.summary,
        title: data.title
      },
      where: { id, userId }
    });

    return count > 0 ? this.getReport({ id, userId }) : null;
  }
}
