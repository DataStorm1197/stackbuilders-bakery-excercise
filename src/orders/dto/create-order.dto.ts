import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEnum, ValidateNested } from 'class-validator';
import { PriorityLevel } from '@prisma/client';
import { CreateOrderItemDto } from './create-order-item.dto';

export class CreateOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];

  @IsEnum(PriorityLevel)
  priorityLevel!: PriorityLevel;
}
