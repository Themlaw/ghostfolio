import { PushNotificationService } from '@ghostfolio/client/services/push-notification.service';

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  MatSlideToggleChange,
  MatSlideToggleModule
} from '@angular/material/slide-toggle';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatSlideToggleModule],
  selector: 'gf-push-notifications-settings',
  styleUrls: ['./push-notifications-settings.component.scss'],
  templateUrl: './push-notifications-settings.component.html'
})
export class GfPushNotificationsSettingsComponent {
  protected readonly pushNotificationService = inject(PushNotificationService);

  protected async onChange({ checked }: MatSlideToggleChange) {
    if (checked) {
      await this.pushNotificationService.subscribe();
    } else {
      await this.pushNotificationService.unsubscribe();
    }
  }
}
