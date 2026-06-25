import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEnum, ValidateNested } from 'class-validator';
import { PriorityLevel } from '@prisma/client';
import { CreateOrderItemDto } from './create-order-item.dto';

export class CreateOrderDto {
  @ApiProperty({ type: [CreateOrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];

  @ApiProperty({ enum: PriorityLevel, example: PriorityLevel.TIER2 })
  @IsEnum(PriorityLevel)
  priorityLevel!: PriorityLevel;
}
