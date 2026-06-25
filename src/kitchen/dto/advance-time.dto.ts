import { IsInt, Min } from 'class-validator';

export class AdvanceTimeDto {
  @IsInt()
  @Min(1)
  minutes!: number;
}
