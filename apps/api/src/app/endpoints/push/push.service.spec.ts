import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';

import * as webPush from 'web-push';

import { PushService, buildPushPayload } from './push.service';

jest.mock('web-push', () => ({ sendNotification: jest.fn() }));

describe('PushService', () => {
  const configuration: Record<string, string> = {
    VAPID_PRIVATE_KEY: 'private',
    VAPID_PUBLIC_KEY: 'public',
    VAPID_SUBJECT: 'mailto:test@example.com'
  };

  let prismaService: {
    pushSubscription: Record<string, jest.Mock>;
  };
  let service: PushService;

  beforeEach(() => {
    (webPush.sendNotification as jest.Mock).mockReset();

    prismaService = {
      pushSubscription: {
        delete: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([
          {
            auth: 'auth',
            endpoint: 'https://push.example.com/1',
            id: 'subscription-id',
            p256dh: 'p256dh'
          }
        ])
      }
    };

    service = new PushService(
      {
        get: (key: string) => configuration[key]
      } as unknown as ConfigurationService,
      prismaService as unknown as PrismaService
    );
  });

  describe('buildPushPayload', () => {
    it('Builds the payload which the Angular service worker expects', () => {
      expect(
        buildPushPayload({
          body: 'Body',
          title: 'Title',
          url: '/home/reports/1'
        })
      ).toEqual({
        notification: {
          body: 'Body',
          title: 'Title',
          data: {
            onActionClick: {
              default: {
                operation: 'navigateLastFocusedOrOpen',
                url: '/home/reports/1'
              }
            }
          },
          icon: '/assets/android-chrome-192x192.png'
        }
      });
    });

    it('Opens the root of the application without a url', () => {
      expect(
        buildPushPayload({ body: 'Body', title: 'Title' }).notification.data
          .onActionClick.default.url
      ).toBe('/');
    });
  });

  describe('sendToUser', () => {
    it('Sends the payload of the Angular service worker', async () => {
      (webPush.sendNotification as jest.Mock).mockResolvedValue({});

      const deliveries = await service.sendToUser({
        notification: { body: 'Body', title: 'Title', url: '/home/reports/1' },
        userId: 'user-id'
      });

      expect(deliveries).toBe(1);

      const [, payload] = (webPush.sendNotification as jest.Mock).mock.calls[0];

      expect(JSON.parse(payload).notification.title).toBe('Title');
      expect(
        JSON.parse(payload).notification.data.onActionClick.default.url
      ).toBe('/home/reports/1');
    });

    it('Removes the subscription which the browser has revoked', async () => {
      (webPush.sendNotification as jest.Mock).mockRejectedValue({
        statusCode: 410
      });

      const deliveries = await service.sendToUser({
        notification: { body: 'Body', title: 'Title' },
        userId: 'user-id'
      });

      expect(deliveries).toBe(0);
      expect(prismaService.pushSubscription.delete).toHaveBeenCalledWith({
        where: { id: 'subscription-id' }
      });
    });
  });
});
