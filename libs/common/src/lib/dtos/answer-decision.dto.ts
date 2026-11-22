import { IsOptional, IsString, MaxLength } from 'class-validator';

export class AnswerDecisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  optionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  text?: string;
}
