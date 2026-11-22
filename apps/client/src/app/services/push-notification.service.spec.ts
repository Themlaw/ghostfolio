import { DataService } from '@ghostfolio/ui/services';

import { TestBed } from '@angular/core/testing';
import '@angular/localize/init';
import { SwPush } from '@angular/service-worker';
import { BehaviorSubject, of } from 'rxjs';

import { PushNotificationService } from './push-notification.service';

describe('PushNotificationService', () => {
  const subscription = {
    endpoint: 'https://push.example.com/1',
    toJSON: () => ({ keys: { auth: 'auth', p256dh: 'p256dh' } })
  };

  let dataService: {
    deletePushSubscription: jest.Mock;
    fetchVapidPublicKey: jest.Mock;
    postPushSubscription: jest.Mock;
  };
  let subscription$: BehaviorSubject<unknown>;
  let swPush: {
    isEnabled: boolean;
    requestSubscription: jest.Mock;
    subscription: BehaviorSubject<unknown>;
    unsubscribe: jest.Mock;
  };

  function createService({ isEnabled = true } = {}) {
    subscription$ = new BehaviorSubject<unknown>(null);

    swPush = {
      isEnabled,
      requestSubscription: jest.fn().mockResolvedValue(subscription),
      subscription: subscription$,
      unsubscribe: jest.fn().mockResolvedValue(undefined)
    };

    dataService = {
      deletePushSubscription: jest.fn().mockReturnValue(of(undefined)),
      fetchVapidPublicKey: jest.fn().mockReturnValue(of({ publicKey: 'key' })),
      postPushSubscription: jest.fn().mockReturnValue(of({ id: 'id' }))
    };

    TestBed.configureTestingModule({
      providers: [
        PushNotificationService,
        { provide: DataService, useValue: dataService },
        { provide: SwPush, useValue: swPush }
      ]
    });

    return TestBed.inject(PushNotificationService);
  }

  beforeAll(() => {
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: { permission: 'default' }
    });
  });

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('subscribes with the VAPID key and sends the subscription', async () => {
    const service = createService();

    expect(await service.subscribe()).toBe(true);

    expect(swPush.requestSubscription).toHaveBeenCalledWith({
      serverPublicKey: 'key'
    });
    expect(dataService.postPushSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: 'auth',
        endpoint: 'https://push.example.com/1',
        p256dh: 'p256dh'
      })
    );
    expect(service.isBusy()).toBe(false);
  });

  it('reports a failure when the permission is refused', async () => {
    const service = createService();

    swPush.requestSubscription.mockRejectedValue(new Error('denied'));
    jest.spyOn(console, 'warn').mockImplementation();

    expect(await service.subscribe()).toBe(false);
    expect(service.hasFailed()).toBe(true);
    expect(dataService.postPushSubscription).not.toHaveBeenCalled();
  });

  it('unsubscribes in the backend and in the browser', async () => {
    const service = createService();

    subscription$.next(subscription);
    TestBed.tick();

    expect(service.isSubscribed()).toBe(true);
    expect(await service.unsubscribe()).toBe(true);
    expect(dataService.deletePushSubscription).toHaveBeenCalledWith({
      endpoint: 'https://push.example.com/1'
    });
    expect(swPush.unsubscribe).toHaveBeenCalled();
  });

  it('does nothing when the service worker is disabled', async () => {
    const service = createService({ isEnabled: false });

    expect(service.isSupported).toBe(false);
    expect(await service.subscribe()).toBe(false);
    expect(swPush.requestSubscription).not.toHaveBeenCalled();
  });
});
