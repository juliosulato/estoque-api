import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Trim } from '../../common/decorators/trim.decorator.js';
import { PaginationDto } from '../../common/dto/pagination.dto.js';

export class ListProductsDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  categoryId?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  search?: string;
}
