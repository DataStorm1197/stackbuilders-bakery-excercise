import { ApiPropertyOptional } from '@nestjs/swagger';
import { Category } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
} from 'class-validator';

export class UpdateMenuItemDto {
  @ApiPropertyOptional({ example: 'Almond Croissant' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ enum: Category, example: Category.PASTRY })
  @IsOptional()
  @IsEnum(Category)
  category?: Category;

  @ApiPropertyOptional({ example: 5.0, description: 'Unit price (up to 2 decimal places)' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  price?: number;

  @ApiPropertyOptional({ example: 25, minimum: 1, description: 'Bake duration in minutes' })
  @IsOptional()
  @IsInt()
  @Min(1)
  bake_minutes?: number;
}
