import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'customer@bakery.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'secret123', minLength: 1 })
  @IsString()
  @MinLength(1)
  password!: string;
}
