import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { PaginationDto } from '../../common/dto/pagination.dto.js';
import { CreateProductDto } from './create-product.dto.js';
import { ListProductsDto } from './list-products.dto.js';
import { UpdateProductDto } from './update-product.dto.js';

async function errorsFor<T extends object>(
  cls: new () => T,
  plain: Record<string, unknown>,
): Promise<string[]> {
  const instance = plainToInstance(cls, plain);
  const errors = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((e) => e.property);
}

describe('UpdateProductDto', () => {
  it.each(['name', 'price', 'active', 'sku', 'categoryId', 'slug', 'minStock'])(
    'rejects null for required field %s',
    async (field) => {
      expect(await errorsFor(UpdateProductDto, { [field]: null })).toEqual([
        field,
      ]);
    },
  );

  it.each(['description', 'costPrice'])(
    'accepts null for nullable field %s',
    async (field) => {
      expect(await errorsFor(UpdateProductDto, { [field]: null })).toEqual([]);
    },
  );

  it('accepts an empty body (every field omitted)', async () => {
    expect(await errorsFor(UpdateProductDto, {})).toEqual([]);
  });

  it('still validates values that are present', async () => {
    expect(
      await errorsFor(UpdateProductDto, { name: '', price: -1, active: 'x' }),
    ).toEqual(['name', 'price', 'active']);
  });

  it('caps price and costPrice at the Decimal(10,2) limit', async () => {
    expect(
      await errorsFor(UpdateProductDto, { price: 99999999.99, costPrice: 1 }),
    ).toEqual([]);
    expect(
      await errorsFor(UpdateProductDto, { price: 100000000, costPrice: 1e9 }),
    ).toEqual(['price', 'costPrice']);
  });
});

describe('CreateProductDto', () => {
  const valid = { sku: 'S', name: 'N', price: 1, categoryId: 'c' };

  it('accepts active omitted or boolean, rejects null', async () => {
    expect(await errorsFor(CreateProductDto, valid)).toEqual([]);
    expect(
      await errorsFor(CreateProductDto, { ...valid, active: false }),
    ).toEqual([]);
    expect(
      await errorsFor(CreateProductDto, { ...valid, active: null }),
    ).toEqual(['active']);
  });

  it('caps price and costPrice at the Decimal(10,2) limit', async () => {
    expect(
      await errorsFor(CreateProductDto, {
        ...valid,
        price: 99999999.99,
        costPrice: 99999999.99,
      }),
    ).toEqual([]);
    expect(
      await errorsFor(CreateProductDto, {
        ...valid,
        price: 100000000,
        costPrice: 100000000,
      }),
    ).toEqual(['price', 'costPrice']);
  });
});

describe('ListProductsDto', () => {
  it('trims search before validating', async () => {
    const dto = plainToInstance(ListProductsDto, { search: '  shirt  ' });
    expect(dto.search).toBe('shirt');
    expect(await errorsFor(ListProductsDto, { search: '  shirt  ' })).toEqual(
      [],
    );
  });

  it('rejects a whitespace-only search', async () => {
    expect(await errorsFor(ListProductsDto, { search: '   ' })).toEqual([
      'search',
    ]);
  });
});

describe('PaginationDto', () => {
  it('caps page and limit', async () => {
    expect(
      await errorsFor(PaginationDto, { page: '10000', limit: '100' }),
    ).toEqual([]);
    expect(
      await errorsFor(PaginationDto, { page: '10001', limit: '101' }),
    ).toEqual(['page', 'limit']);
  });
});

describe('sku trimming', () => {
  const valid = { sku: 'S', name: 'N', price: 1, categoryId: 'c' };

  it.each([
    ['CreateProductDto', CreateProductDto, valid],
    ['UpdateProductDto', UpdateProductDto, {}],
  ] as const)('%s trims the sku before validating', async (_n, cls, base) => {
    const dto = plainToInstance(cls, { ...base, sku: '  ABC-1  ' });
    expect(dto.sku).toBe('ABC-1');
    expect(await errorsFor(cls, { ...base, sku: '  ABC-1  ' })).toEqual([]);
  });

  it.each([
    ['CreateProductDto', CreateProductDto, valid],
    ['UpdateProductDto', UpdateProductDto, {}],
  ] as const)('%s rejects a whitespace-only sku', async (_n, cls, base) => {
    expect(await errorsFor(cls, { ...base, sku: '   ' })).toEqual(['sku']);
  });
});
