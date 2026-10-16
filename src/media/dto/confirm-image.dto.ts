import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Trim } from '../../common/decorators/trim.decorator.js';

export class ConfirmImageDto {
  @IsString()
  @IsNotEmpty()
  key!: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(255)
  alt?: string;
}
