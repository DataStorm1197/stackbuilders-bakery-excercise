import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class AdvanceTimeDto {
  @ApiProperty({ example: 30, minimum: 1, description: 'Minutes to advance kitchen clock (test environments only)' })
  @IsInt()
  @Min(1)
  minutes!: number;
}
