import { HasPermission } from '@ghostfolio/api/decorators/has-permission.decorator';
import { Impersonation } from '@ghostfolio/api/decorators/impersonation.decorator';
import { RequiresScope } from '@ghostfolio/api/decorators/requires-scope.decorator';
import {
  CreatePushSubscriptionDto,
  DeletePushSubscriptionDto
} from '@ghostfolio/common/dtos';
import { permissions } from '@ghostfolio/common/permissions';
import { scopes } from '@ghostfolio/common/scopes';
import type { ImpersonationContext } from '@ghostfolio/common/types';

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Post
} from '@nestjs/common';
import { StatusCodes } from 'http-status-codes';

import { PushService } from './push.service';

@Controller()
export class PushController {
  public constructor(private readonly pushService: PushService) {}

  @Get('push/vapid-public-key')
  @HasPermission(permissions.readReport)
  @RequiresScope(scopes.reportRead)
  public getVapidPublicKey() {
    const publicKey = this.pushService.getVapidPublicKey();

    if (!publicKey) {
      throw new NotFoundException();
    }

    return { publicKey };
  }

  @HasPermission(permissions.readReport)
  @Post('push-subscriptions')
  @RequiresScope(scopes.reportRead)
  public async createPushSubscription(
    @Body() data: CreatePushSubscriptionDto,
    @Impersonation() { userId }: ImpersonationContext
  ) {
    return this.pushService.subscribe({ ...data, userId });
  }

  @Delete('push-subscriptions')
  @HasPermission(permissions.readReport)
  @RequiresScope(scopes.reportRead)
  @HttpCode(StatusCodes.NO_CONTENT)
  public async deletePushSubscription(
    @Body() { endpoint }: DeletePushSubscriptionDto,
    @Impersonation() { userId }: ImpersonationContext
  ) {
    await this.pushService.unsubscribe({ endpoint, userId });
  }
}
