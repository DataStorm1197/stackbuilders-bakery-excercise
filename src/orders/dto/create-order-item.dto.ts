import { IsInt, IsString, Min } from 'class-validator';

export class CreateOrderItemDto {
  @IsString()
  menuItemId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}
