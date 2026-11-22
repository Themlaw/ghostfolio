import { DataService } from '@ghostfolio/ui/services';

import { computed, inject, Service, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { SwPush } from '@angular/service-worker';
import { firstValueFrom } from 'rxjs';

const KEY_PUSH_BANNER_DISMISSED = 'GF_PUSH_BANNER_DISMISSED';

@Service()
export class PushNotificationService {
  private readonly dataService = inject(DataService);
  private readonly swPush = inject(SwPush);

  private readonly currentSubscription = toSignal(this.swPush.subscription, {
    initialValue: undefined
  });

  public readonly hasFailed = signal(false);
  public readonly isBannerDismissed = signal(this.readBannerDismissed());
  public readonly isBusy = signal(false);
  public readonly isDenied = signal(this.readPermission() === 'denied');
  public readonly isSubscribed = computed(() => !!this.currentSubscription());

  public get isSupported() {
    return this.swPush.isEnabled && typeof Notification !== 'undefined';
  }

  public dismissBanner() {
    this.isBannerDismissed.set(true);

    try {
      localStorage.setItem(KEY_PUSH_BANNER_DISMISSED, 'true');
    } catch {}
  }

  public async subscribe() {
    if (!this.isSupported || this.isBusy()) {
      return false;
    }

    this.hasFailed.set(false);
    this.isBusy.set(true);

    try {
      const { publicKey } = await firstValueFrom(
        this.dataService.fetchVapidPublicKey()
      );

      // Asks for the permission of the browser
      const subscription = await this.swPush.requestSubscription({
        serverPublicKey: publicKey
      });

      const { auth, p256dh } = this.getKeys(subscription);

      await firstValueFrom(
        this.dataService.postPushSubscription({
          auth,
          p256dh,
          endpoint: subscription.endpoint,
          userAgent: navigator.userAgent.slice(0, 500)
        })
      );

      return true;
    } catch (error) {
      console.warn('Could not enable the notifications', error);

      this.hasFailed.set(true);

      return false;
    } finally {
      this.isDenied.set(this.readPermission() === 'denied');
      this.isBusy.set(false);
    }
  }

  public async unsubscribe() {
    if (!this.isSupported || this.isBusy()) {
      return false;
    }

    this.hasFailed.set(false);
    this.isBusy.set(true);

    try {
      const subscription = this.currentSubscription();

      if (subscription) {
        await firstValueFrom(
          this.dataService.deletePushSubscription({
            endpoint: subscription.endpoint
          })
        );
      }

      await this.swPush.unsubscribe();

      return true;
    } catch (error) {
      console.warn('Could not disable the notifications', error);

      this.hasFailed.set(true);

      return false;
    } finally {
      this.isBusy.set(false);
    }
  }

  private getKeys(subscription: PushSubscription) {
    const { keys } = subscription.toJSON();

    if (!keys?.auth || !keys?.p256dh) {
      throw new Error('The subscription has no keys');
    }

    return { auth: keys.auth, p256dh: keys.p256dh };
  }

  private readBannerDismissed() {
    try {
      return localStorage.getItem(KEY_PUSH_BANNER_DISMISSED) === 'true';
    } catch {
      return false;
    }
  }

  private readPermission() {
    return typeof Notification === 'undefined'
      ? undefined
      : Notification.permission;
  }
}
