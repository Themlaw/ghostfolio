import { HasPermission } from '@ghostfolio/api/decorators/has-permission.decorator';
import { Impersonation } from '@ghostfolio/api/decorators/impersonation.decorator';
import {
  CreatePushSubscriptionDto,
  DeletePushSubscriptionDto
} from '@ghostfolio/common/dtos';
import { permissions } from '@ghostfolio/common/permissions';
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
  public getVapidPublicKey() {
    const publicKey = this.pushService.getVapidPublicKey();

    if (!publicKey) {
      throw new NotFoundException();
    }

    return { publicKey };
  }

  @HasPermission(permissions.readReport)
  @Post('push-subscriptions')
  public async createPushSubscription(
    @Body() data: CreatePushSubscriptionDto,
    @Impersonation() { userId }: ImpersonationContext
  ) {
    return this.pushService.subscribe({ ...data, userId });
  }

  @Delete('push-subscriptions')
  @HasPermission(permissions.readReport)
  @HttpCode(StatusCodes.NO_CONTENT)
  public async deletePushSubscription(
    @Body() { endpoint }: DeletePushSubscriptionDto,
    @Impersonation() { userId }: ImpersonationContext
  ) {
    await this.pushService.unsubscribe({ endpoint, userId });
  }
}
