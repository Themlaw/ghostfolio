import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';

import { BadRequestException } from '@nestjs/common';

import { PushService } from '../push/push.service';
import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  const userId = 'user-id';

  let prismaService: {
    decision: Record<string, jest.Mock>;
    report: Record<string, jest.Mock>;
  };
  let pushService: { sendToUser: jest.Mock };
  let service: ReportsService;

  beforeEach(() => {
    prismaService = {
      decision: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      report: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    };

    pushService = { sendToUser: jest.fn().mockResolvedValue(1) };

    service = new ReportsService(
      prismaService as unknown as PrismaService,
      pushService as unknown as PushService
    );
  });

  describe('createReport', () => {
    function mockCreated(decisions: unknown[] = []) {
      prismaService.report.create.mockResolvedValue({
        decisions,
        id: 'report-id',
        summary: 'Summary',
        title: 'Title'
      });
    }

    it('Creates the report with the decisions of the user', async () => {
      mockCreated();

      await service.createReport({
        userId,
        data: {
          kind: 'BRIEF',
          summary: 'Summary',
          title: 'Title',
          decisions: [
            { question: 'Buy?', options: [{ id: 'a', label: 'Yes' }] }
          ]
        }
      });

      const { data } = prismaService.report.create.mock.calls[0][0];

      expect(data.userId).toEqual(userId);
      expect(data.decisions.create).toEqual([
        { question: 'Buy?', userId, options: [{ id: 'a', label: 'Yes' }] }
      ]);
    });

    it('Notifies the user about an important point', async () => {
      mockCreated();

      await service.createReport({
        userId,
        data: {
          kind: 'BRIEF',
          summary: 'Summary',
          title: 'Title',
          points: [{ level: 'important', subject: 'NVDA', text: 'Text' }]
        }
      });

      expect(pushService.sendToUser).toHaveBeenCalledTimes(1);
    });

    it('Notifies the user about a decision', async () => {
      mockCreated([{ id: 'decision-id' }]);

      await service.createReport({
        userId,
        data: { kind: 'BRIEF', summary: 'Summary', title: 'Title' }
      });

      expect(pushService.sendToUser).toHaveBeenCalledTimes(1);
    });

    it('Does not notify the user about a note', async () => {
      mockCreated();

      await service.createReport({
        userId,
        data: {
          kind: 'BRIEF',
          summary: 'Summary',
          title: 'Title',
          points: [{ level: 'note', subject: 'NVDA', text: 'Text' }]
        }
      });

      expect(pushService.sendToUser).not.toHaveBeenCalled();
    });
  });

  describe('getReports', () => {
    it('Filters by user, kind, subject and text, and limits the page', async () => {
      await service.getReports({
        kind: 'LESSON',
        q: 'etf',
        subject: 'VWCE',
        take: 1000,
        userId
      });

      const { orderBy, take, where } =
        prismaService.report.findMany.mock.calls[0][0];

      expect(where.userId).toEqual(userId);
      expect(where.kind).toEqual('LESSON');
      expect(where.subjects).toEqual({ has: 'VWCE' });
      expect(where.OR).toHaveLength(3);
      expect(orderBy).toEqual({ publishedAt: 'desc' });
      expect(take).toEqual(50);
    });
  });

  describe('answerDecision', () => {
    it('Requires an option or a text', async () => {
      await expect(
        service.answerDecision({ id: 'decision-id', userId })
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('Returns null for a decision of another user', async () => {
      prismaService.decision.findFirst.mockResolvedValue(null);

      expect(
        await service.answerDecision({ id: 'x', optionId: 'a', userId })
      ).toBeNull();
      expect(prismaService.decision.findFirst).toHaveBeenCalledWith({
        where: { id: 'x', userId }
      });
    });

    it('Refuses an option which the decision does not have', async () => {
      prismaService.decision.findFirst.mockResolvedValue({
        options: [{ id: 'a', label: 'Yes' }]
      });

      await expect(
        service.answerDecision({ id: 'x', optionId: 'b', userId })
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('Decides the decision with the option', async () => {
      prismaService.decision.findFirst.mockResolvedValue({
        options: [{ id: 'a', label: 'Yes' }]
      });

      await service.answerDecision({
        id: 'x',
        optionId: 'a',
        text: ' because ',
        userId
      });

      const { data } = prismaService.decision.update.mock.calls[0][0];

      expect(data.status).toEqual('DECIDED');
      expect(data.answerOptionId).toEqual('a');
      expect(data.answerText).toEqual('because');
      expect(data.decidedAt).toBeInstanceOf(Date);
    });
  });

  describe('setDecisionStatus', () => {
    it('Reopens the decision and removes the answer', async () => {
      await service.setDecisionStatus({ id: 'x', status: 'OPEN', userId });

      expect(prismaService.decision.updateMany).toHaveBeenCalledWith({
        data: {
          answerOptionId: null,
          answerText: null,
          decidedAt: null,
          status: 'OPEN'
        },
        where: { id: 'x', userId }
      });
    });
  });

  describe('getDecisions', () => {
    it('Reads the decisions decided since a date', async () => {
      const since = new Date('2026-11-01');

      await service.getDecisions({ since, status: 'DECIDED', userId });

      expect(prismaService.decision.findMany.mock.calls[0][0].where).toEqual({
        decidedAt: { gte: since },
        status: 'DECIDED',
        userId
      });
    });
  });

  describe('deleteReport and updateReport', () => {
    it('Deletes only a report of the user', async () => {
      expect(await service.deleteReport({ id: 'x', userId })).toBe(true);
      expect(prismaService.report.deleteMany).toHaveBeenCalledWith({
        where: { id: 'x', userId }
      });
    });

    it('Gives null if the report of the user does not exist', async () => {
      prismaService.report.updateMany.mockResolvedValue({ count: 0 });

      expect(
        await service.updateReport({ data: { title: 'T' }, id: 'x', userId })
      ).toBeNull();
    });
  });
});
