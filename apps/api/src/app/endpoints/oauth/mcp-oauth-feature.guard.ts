import { isMcpOAuthEnabled } from '@ghostfolio/api/helper/mcp-oauth.helper';
import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';

import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';

/**
 * Hides the endpoints of the authorization server while the authorization with
 * OAuth 2.1 of the Model Context Protocol (MCP) is disabled
 */
@Injectable()
export class McpOAuthFeatureGuard implements CanActivate {
  public constructor(
    private readonly configurationService: ConfigurationService
  ) {}

  public canActivate() {
    if (!isMcpOAuthEnabled(this.configurationService)) {
      throw new NotFoundException();
    }

    return true;
  }
}
