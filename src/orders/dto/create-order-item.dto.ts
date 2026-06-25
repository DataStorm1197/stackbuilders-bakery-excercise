import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Min } from 'class-validator';

export class CreateOrderItemDto {
  @ApiProperty({ example: 'clxyz1234abcd', description: 'Menu item ID' })
  @IsString()
  menuItemId!: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;
}
