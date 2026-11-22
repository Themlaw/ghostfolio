import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';

import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';

/**
 * Hides the endpoints of the reports while the feature is disabled
 */
@Injectable()
export class ReportsFeatureGuard implements CanActivate {
  public constructor(
    private readonly configurationService: ConfigurationService
  ) {}

  public canActivate() {
    if (!this.configurationService.get('ENABLE_FEATURE_REPORTS')) {
      throw new NotFoundException();
    }

    return true;
  }
}
