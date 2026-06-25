import { Category } from '@prisma/client';
import { IsEnum, IsInt, IsNumber, IsPositive, IsString, Min } from 'class-validator';

export class CreateMenuItemDto {
  @IsString()
  name!: string;

  @IsEnum(Category)
  category!: Category;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  price!: number;

  @IsInt()
  @Min(1)
  bake_minutes!: number;
}
