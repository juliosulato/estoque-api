import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ProductsService } from './products.service.js';

const existingProduct = {
  id: 'p1',
  sku: 'SKU-1',
  slug: 'camiseta-azul',
  categoryId: 'c1',
};

function createPrismaMock() {
  return {
    product: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    category: { findUnique: vi.fn() },
    stock: { deleteMany: vi.fn() },
    stockMovement: { count: vi.fn() },
    $transaction: vi.fn(),
  };
}

describe('ProductsService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: ProductsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    prisma.category.findUnique.mockResolvedValue({ id: 'c1' });
    prisma.product.findUnique.mockResolvedValue(null);
    service = new ProductsService(prisma as unknown as PrismaService);
  });

  describe('create', () => {
    const dto = {
      sku: 'SKU-1',
      name: 'Camiseta Azul',
      price: 49.9,
      categoryId: 'c1',
    };

    it('generates the slug from the name when none is given', async () => {
      await service.create(dto);

      expect(prisma.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ slug: 'camiseta-azul' }),
        }),
      );
    });

    it('normalizes an explicit slug', async () => {
      await service.create({ ...dto, slug: 'Minha Camiseta' });

      expect(prisma.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ slug: 'minha-camiseta' }),
        }),
      );
    });

    it('creates the product and its stock in a single nested write', async () => {
      await service.create({ ...dto, minStock: 5 });

      expect(prisma.product.create).toHaveBeenCalledTimes(1);
      expect(prisma.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            stock: { create: { quantity: 0, minStock: 5 } },
          }),
        }),
      );
    });

    it('defaults minStock to 0', async () => {
      await service.create(dto);

      expect(prisma.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            stock: { create: { quantity: 0, minStock: 0 } },
          }),
        }),
      );
    });

    it.each([
      ['name', { name: '!!!' }],
      ['explicit slug', { slug: '---' }],
    ])('rejects an empty slug derived from the %s', async (_label, patch) => {
      await expect(service.create({ ...dto, ...patch })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.product.create).not.toHaveBeenCalled();
    });

    it('rejects a duplicated sku naming the field', async () => {
      prisma.product.findUnique.mockImplementation(
        ({ where }: { where: { sku?: string } }) =>
          Promise.resolve(where.sku ? existingProduct : null),
      );

      await expect(service.create(dto)).rejects.toThrow(/sku "SKU-1"/);
      expect(prisma.product.create).not.toHaveBeenCalled();
    });

    it('rejects a duplicated slug naming the field', async () => {
      prisma.product.findUnique.mockImplementation(
        ({ where }: { where: { slug?: string } }) =>
          Promise.resolve(where.slug ? existingProduct : null),
      );

      const result = service.create(dto);
      await expect(result).rejects.toThrow(/slug "camiseta-azul"/);
      await expect(result).rejects.toThrow(/explicit "slug"/);
      expect(prisma.product.create).not.toHaveBeenCalled();
    });

    it('rejects an unknown category', async () => {
      prisma.category.findUnique.mockResolvedValue(null);

      await expect(service.create(dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.product.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    beforeEach(() => {
      prisma.product.findUnique.mockImplementation(
        ({ where }: { where: { id?: string } }) =>
          Promise.resolve(where.id === 'p1' ? existingProduct : null),
      );
    });

    it('does not touch the slug when only the name changes', async () => {
      await service.update('p1', { name: 'Outro Nome' });

      const call = prisma.product.update.mock.calls[0]?.[0] as {
        data: Record<string, unknown>;
      };
      expect(call.data.name).toBe('Outro Nome');
      expect(call.data).not.toHaveProperty('slug');
    });

    it('updates minStock only through the nested stock update, never quantity', async () => {
      await service.update('p1', { minStock: 9 });

      const call = prisma.product.update.mock.calls[0]?.[0] as {
        data: Record<string, unknown>;
      };
      expect(call.data.stock).toEqual({
        upsert: {
          create: { quantity: 0, minStock: 9 },
          update: { minStock: 9 },
        },
      });
    });

    it('rejects a slug that normalizes to empty', async () => {
      await expect(
        service.update('p1', { slug: '---' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.product.update).not.toHaveBeenCalled();
    });

    it('upserts the stock row so a product without one does not fail', async () => {
      await service.update('p1', { minStock: 0 });

      const call = prisma.product.update.mock.calls[0]?.[0] as {
        data: { stock?: { upsert: { create: { quantity: number } } } };
      };
      expect(call.data.stock?.upsert.create.quantity).toBe(0);
    });

    it('leaves stock alone when minStock is omitted', async () => {
      await service.update('p1', { name: 'X' });

      const call = prisma.product.update.mock.calls[0]?.[0] as {
        data: Record<string, unknown>;
      };
      expect(call.data).not.toHaveProperty('stock');
    });

    it('forwards null description and costPrice to clear them', async () => {
      await service.update('p1', {
        description: null,
        costPrice: null,
      } as never);

      const call = prisma.product.update.mock.calls[0]?.[0] as {
        data: Record<string, unknown>;
      };
      expect(call.data.description).toBeNull();
      expect(call.data.costPrice).toBeNull();
    });

    it('rejects an unknown category on category change', async () => {
      prisma.category.findUnique.mockResolvedValue(null);

      await expect(
        service.update('p1', { categoryId: 'nope' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    beforeEach(() => {
      prisma.product.findUnique.mockResolvedValue(existingProduct);
    });

    it('blocks deletion when the product has stock movements', async () => {
      prisma.stockMovement.count.mockResolvedValue(2);

      const result = service.remove('p1');

      await expect(result).rejects.toBeInstanceOf(ConflictException);
      await expect(result).rejects.toThrow(/"active": false/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('deletes stock and product in one transaction when there are no movements', async () => {
      prisma.stockMovement.count.mockResolvedValue(0);

      await service.remove('p1');

      expect(prisma.stock.deleteMany).toHaveBeenCalledWith({
        where: { productId: 'p1' },
      });
      expect(prisma.product.delete).toHaveBeenCalledWith({
        where: { id: 'p1' },
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });
});
