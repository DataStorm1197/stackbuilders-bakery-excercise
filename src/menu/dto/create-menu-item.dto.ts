import { ApiProperty } from '@nestjs/swagger';
import { Category } from '@prisma/client';
import { IsEnum, IsInt, IsNumber, IsPositive, IsString, Min } from 'class-validator';

export class CreateMenuItemDto {
  @ApiProperty({ example: 'Croissant' })
  @IsString()
  name!: string;

  @ApiProperty({ enum: Category, example: Category.PASTRY })
  @IsEnum(Category)
  category!: Category;

  @ApiProperty({ example: 4.5, description: 'Unit price (up to 2 decimal places)' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  price!: number;

  @ApiProperty({ example: 20, minimum: 1, description: 'Bake duration in minutes' })
  @IsInt()
  @Min(1)
  bake_minutes!: number;
}
