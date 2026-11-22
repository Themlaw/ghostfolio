import {
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength
} from 'class-validator';

export class CreatePushSubscriptionDto {
  @IsString()
  @MaxLength(500)
  @MinLength(1)
  auth: string;

  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2000)
  endpoint: string;

  @IsString()
  @MaxLength(500)
  @MinLength(1)
  p256dh: string;

  @IsObject()
  @IsOptional()
  preferences?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  userAgent?: string;
}

export class DeletePushSubscriptionDto {
  @IsString()
  @MaxLength(2000)
  @MinLength(1)
  endpoint: string;
}
