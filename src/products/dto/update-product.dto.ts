import { OmitType, PartialType } from '@nestjs/mapped-types';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Trim } from '../../common/decorators/trim.decorator.js';
import { CreateProductDto, MAX_MONEY } from './create-product.dto.js';

const REQUIRED_FIELDS = [
  'sku',
  'name',
  'slug',
  'price',
  'active',
  'categoryId',
  'minStock',
] as const;

const notUndefined = () => ValidateIf((_, value) => value !== undefined);

export class UpdateProductDto extends PartialType(
  OmitType(CreateProductDto, REQUIRED_FIELDS),
) {
  @Trim()
  @notUndefined()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  sku?: string;

  @notUndefined()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name?: string;

  @notUndefined()
  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  slug?: string;

  @notUndefined()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_MONEY)
  price?: number;

  @notUndefined()
  @IsBoolean()
  active?: boolean;

  @notUndefined()
  @IsString()
  @IsNotEmpty()
  categoryId?: string;

  @notUndefined()
  @IsInt()
  @Min(0)
  minStock?: number;
}
