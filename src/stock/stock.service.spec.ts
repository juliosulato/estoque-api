import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { StockService } from './stock.service.js';

function createPrismaMock() {
  const mock = {
    product: { findUnique: vi.fn() },
    stock: {
      update: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    stockMovement: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(),
  };
  // Interactive transactions receive the same mock as the tx client.
  mock.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === 'function' ? arg(mock) : Promise.all(arg as unknown[]),
  );
  return mock;
}

describe('StockService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: StockService;

  beforeEach(() => {
    prisma = createPrismaMock();
    prisma.product.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.stockMovement.create.mockResolvedValue({ id: 'm1' });
    prisma.stock.findUniqueOrThrow.mockResolvedValue({
      quantity: 15,
      minStock: 0,
    });
    service = new StockService(prisma as unknown as PrismaService);
  });

  describe('createMovement', () => {
    it('increments the balance on ENTRY and logs the movement', async () => {
      const result = await service.createMovement('p1', 'u1', {
        type: 'ENTRY',
        quantity: 5,
        reason: 'purchase',
      });

      expect(prisma.stock.update).toHaveBeenCalledWith({
        where: { productId: 'p1' },
        data: { quantity: { increment: 5 } },
      });
      expect(prisma.stockMovement.create).toHaveBeenCalledWith({
        data: {
          productId: 'p1',
          userId: 'u1',
          type: 'ENTRY',
          quantity: 5,
          reason: 'purchase',
        },
      });
      expect(result).toEqual({
        movement: { id: 'm1' },
        stock: { quantity: 15, minStock: 0 },
      });
    });

    it('decrements conditionally on EXIT with enough balance', async () => {
      prisma.stock.updateMany.mockResolvedValue({ count: 1 });

      await service.createMovement('p1', 'u1', { type: 'EXIT', quantity: 3 });

      expect(prisma.stock.updateMany).toHaveBeenCalledWith({
        where: { productId: 'p1', quantity: { gte: 3 } },
        data: { quantity: { decrement: 3 } },
      });
      expect(prisma.stockMovement.create).toHaveBeenCalledTimes(1);
    });

    it('throws 409 and logs nothing on EXIT without enough balance', async () => {
      prisma.stock.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.createMovement('p1', 'u1', { type: 'EXIT', quantity: 99 }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.stockMovement.create).not.toHaveBeenCalled();
    });

    it('throws 404 when the product does not exist', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(
        service.createMovement('nope', 'u1', { type: 'ENTRY', quantity: 1 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.stock.update).not.toHaveBeenCalled();
      expect(prisma.stockMovement.create).not.toHaveBeenCalled();
    });
  });

  describe('findMovements', () => {
    it('paginates newest first', async () => {
      prisma.stockMovement.findMany.mockResolvedValue([{ id: 'm1' }]);
      prisma.stockMovement.count.mockResolvedValue(1);

      const result = await service.findMovements('p1', { page: 2, limit: 10 });

      expect(prisma.stockMovement.findMany).toHaveBeenCalledWith({
        where: { productId: 'p1' },
        skip: 10,
        take: 10,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      expect(result).toEqual({
        data: [{ id: 'm1' }],
        total: 1,
        page: 2,
        limit: 10,
      });
    });

    it('throws 404 when the product does not exist', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(
        service.findMovements('nope', { page: 1, limit: 20 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
