import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StatusCodes } from 'http-status-codes';
import * as webPush from 'web-push';

export interface PushNotification {
  body: string;
  title: string;
  url?: string;
}

export const PUSH_NOTIFICATION_ICON = '/assets/android-chrome-192x192.png';

/**
 * Builds the payload which the Angular service worker (`SwPush`) expects. A
 * click on the notification focuses or opens the application at the url.
 */
export function buildPushPayload({ body, title, url }: PushNotification) {
  return {
    notification: {
      body,
      title,
      data: {
        onActionClick: {
          default: {
            operation: 'navigateLastFocusedOrOpen',
            url: url ?? '/'
          }
        }
      },
      icon: PUSH_NOTIFICATION_ICON
    }
  };
}

@Injectable()
export class PushService {
  public constructor(
    private readonly configurationService: ConfigurationService,
    private readonly prismaService: PrismaService
  ) {}

  public getVapidPublicKey() {
    return this.isConfigured()
      ? this.configurationService.get('VAPID_PUBLIC_KEY')
      : undefined;
  }

  public isConfigured() {
    return !!(
      this.configurationService.get('VAPID_PUBLIC_KEY') &&
      this.configurationService.get('VAPID_PRIVATE_KEY') &&
      this.configurationService.get('VAPID_SUBJECT')
    );
  }

  public async subscribe({
    auth,
    endpoint,
    p256dh,
    preferences,
    userAgent,
    userId
  }: {
    auth: string;
    endpoint: string;
    p256dh: string;
    preferences?: Record<string, unknown>;
    userAgent?: string;
    userId: string;
  }) {
    const data = {
      auth,
      p256dh,
      userAgent,
      preferences: (preferences ?? {}) as Prisma.InputJsonValue
    };

    // The endpoint identifies a browser. A browser which signs in as another
    // user moves the subscription to this user.
    const subscription = await this.prismaService.pushSubscription.upsert({
      create: { ...data, endpoint, userId },
      update: { ...data, userId },
      where: { endpoint }
    });

    return { id: subscription.id };
  }

  public async unsubscribe({
    endpoint,
    userId
  }: {
    endpoint: string;
    userId: string;
  }) {
    await this.prismaService.pushSubscription.deleteMany({
      where: { endpoint, userId }
    });
  }

  /**
   * Sends the notification to the browsers of the user and gives the number of
   * the deliveries. It never throws, because a notification is a side effect
   * which must not fail the request which triggers it.
   */
  public async sendToUser({
    notification,
    userId
  }: {
    notification: PushNotification;
    userId: string;
  }): Promise<number> {
    if (!this.isConfigured()) {
      return 0;
    }

    try {
      const subscriptions = await this.prismaService.pushSubscription.findMany({
        where: { userId }
      });

      const payload = JSON.stringify(buildPushPayload(notification));

      const results = await Promise.all(
        subscriptions.map(async ({ auth, endpoint, id, p256dh }) => {
          try {
            await webPush.sendNotification(
              { endpoint, keys: { auth, p256dh } },
              payload,
              {
                TTL: 60 * 60 * 24,
                vapidDetails: {
                  privateKey:
                    this.configurationService.get('VAPID_PRIVATE_KEY'),
                  publicKey: this.configurationService.get('VAPID_PUBLIC_KEY'),
                  subject: this.configurationService.get('VAPID_SUBJECT')
                }
              }
            );

            return true;
          } catch (error) {
            const statusCode = (error as { statusCode?: number })?.statusCode;

            if (
              statusCode === StatusCodes.GONE ||
              statusCode === StatusCodes.NOT_FOUND
            ) {
              // The browser has revoked the subscription
              await this.prismaService.pushSubscription
                .delete({ where: { id } })
                .catch(() => undefined);
            } else {
              Logger.warn(
                `Push notification failed (${statusCode ?? 'unknown'})`,
                'PushService'
              );
            }

            return false;
          }
        })
      );

      return results.filter(Boolean).length;
    } catch (error) {
      Logger.warn(error, 'PushService');

      return 0;
    }
  }
}
