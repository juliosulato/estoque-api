import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  slug?: string;

  @IsOptional()
  @IsString()
  parentId?: string;
}
