import type { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { PresignImageDto } from './dto/presign-image.dto.js';
import { MediaService } from './media.service.js';

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(),
}));

const configValues: Record<string, string> = {
  S3_BUCKET: 'bucket',
  S3_PUBLIC_BASE_URL: 'https://cdn.example.com/',
};

function createPrismaMock() {
  return {
    product: { findUnique: vi.fn() },
    productImage: {
      count: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      aggregate: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  };
}

describe('MediaService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let s3: { send: ReturnType<typeof vi.fn> };
  let service: MediaService;

  beforeEach(() => {
    vi.mocked(getSignedUrl).mockReset();
    prisma = createPrismaMock();
    prisma.product.findUnique.mockResolvedValue({ id: 'p1' });
    s3 = { send: vi.fn() };
    service = new MediaService(
      prisma as unknown as PrismaService,
      s3 as unknown as S3Client,
      {
        get: (key: string) => configValues[key],
      } as unknown as ConfigService<never, true>,
    );
  });

  describe('presign', () => {
    const dto = { contentType: 'image/png' as const, size: 1024 };

    it('rejects content types outside the allowed list (DTO)', async () => {
      const errors = await validate(
        plainToInstance(PresignImageDto, { contentType: 'image/gif', size: 1 }),
      );
      expect(errors.map((e) => e.property)).toContain('contentType');
    });

    it('throws NotFoundException when the product does not exist', async () => {
      prisma.product.findUnique.mockResolvedValue(null);
      await expect(service.presign('p1', dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects sizes above 5 MB', async () => {
      await expect(
        service.presign('p1', { ...dto, size: 5 * 1024 * 1024 + 1 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws ConflictException when the product already has 10 images', async () => {
      prisma.productImage.count.mockResolvedValue(10);
      await expect(service.presign('p1', dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('signs a server-generated key with content type and length', async () => {
      prisma.productImage.count.mockResolvedValue(0);
      vi.mocked(getSignedUrl).mockResolvedValue('https://signed');

      const result = await service.presign('p1', dto);

      expect(result.uploadUrl).toBe('https://signed');
      expect(result.expiresIn).toBe(300);
      expect(result.key).toMatch(/^products\/p1\/[0-9a-f-]{36}\.png$/);
      const [, command, options] = vi.mocked(getSignedUrl).mock.calls[0] as [
        unknown,
        { input: Record<string, unknown> },
        { expiresIn: number },
      ];
      expect(command.input).toEqual({
        Bucket: 'bucket',
        Key: result.key,
        ContentType: 'image/png',
        ContentLength: 1024,
      });
      expect(options.expiresIn).toBe(300);
    });
  });

  describe('confirm', () => {
    const key = 'products/p1/abc.jpg';

    it('rejects keys from another product', async () => {
      await expect(
        service.confirm('p1', { key: 'products/p2/abc.jpg' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(s3.send).not.toHaveBeenCalled();
    });

    it('rejects an already registered key', async () => {
      prisma.productImage.findFirst.mockResolvedValue({ id: 'i1' });
      await expect(service.confirm('p1', { key })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rejects when the object does not exist in S3', async () => {
      prisma.productImage.findFirst.mockResolvedValue(null);
      s3.send.mockRejectedValue(
        Object.assign(new Error('nf'), { name: 'NotFound' }),
      );
      await expect(service.confirm('p1', { key })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects objects with invalid type or size', async () => {
      prisma.productImage.findFirst.mockResolvedValue(null);
      s3.send.mockResolvedValue({
        ContentType: 'text/html',
        ContentLength: 10,
      });
      await expect(service.confirm('p1', { key })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      s3.send.mockResolvedValue({
        ContentType: 'image/jpeg',
        ContentLength: 5 * 1024 * 1024 + 1,
      });
      await expect(service.confirm('p1', { key })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('creates the image with url and order = max + 1', async () => {
      prisma.productImage.findFirst.mockResolvedValue(null);
      s3.send.mockResolvedValue({
        ContentType: 'image/jpeg',
        ContentLength: 10,
      });
      prisma.productImage.aggregate.mockResolvedValue({ _max: { order: 2 } });

      await service.confirm('p1', { key, alt: 'front' });

      expect(prisma.productImage.create).toHaveBeenCalledWith({
        data: {
          productId: 'p1',
          key,
          url: `https://cdn.example.com/${key}`,
          alt: 'front',
          order: 3,
        },
      });
    });

    it('starts at order 0 for the first image', async () => {
      prisma.productImage.findFirst.mockResolvedValue(null);
      s3.send.mockResolvedValue({
        ContentType: 'image/jpeg',
        ContentLength: 10,
      });
      prisma.productImage.aggregate.mockResolvedValue({
        _max: { order: null },
      });

      await service.confirm('p1', { key });

      expect(prisma.productImage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ order: 0 }),
      });
    });
  });

  describe('reorder', () => {
    beforeEach(() => {
      prisma.productImage.findMany.mockResolvedValue([
        { id: 'a' },
        { id: 'b' },
        { id: 'c' },
      ]);
    });

    it('rejects missing ids', async () => {
      await expect(
        service.reorder('p1', { ids: ['a', 'b'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects extra or foreign ids', async () => {
      await expect(
        service.reorder('p1', { ids: ['a', 'b', 'c', 'd'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.reorder('p1', { ids: ['a', 'b', 'x'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('updates every order in a single transaction', async () => {
      await service.reorder('p1', { ids: ['c', 'a', 'b'] });

      expect(prisma.productImage.update).toHaveBeenCalledTimes(3);
      expect(prisma.productImage.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'c' },
        data: { order: 0 },
      });
      expect(prisma.productImage.update).toHaveBeenNthCalledWith(3, {
        where: { id: 'b' },
        data: { order: 2 },
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when the image belongs to another product', async () => {
      prisma.productImage.findFirst.mockResolvedValue(null);
      await expect(service.remove('p1', 'i1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.productImage.findFirst).toHaveBeenCalledWith({
        where: { id: 'i1', productId: 'p1' },
      });
    });

    it('deletes the row before the S3 object', async () => {
      prisma.productImage.findFirst.mockResolvedValue({
        id: 'i1',
        key: 'products/p1/a.jpg',
      });
      s3.send.mockResolvedValue({});

      await service.remove('p1', 'i1');

      const dbOrder = prisma.productImage.delete.mock.invocationCallOrder[0]!;
      const s3Order = s3.send.mock.invocationCallOrder[0]!;
      expect(dbOrder).toBeLessThan(s3Order);
    });

    it('does not fail when S3 deletion fails', async () => {
      prisma.productImage.findFirst.mockResolvedValue({
        id: 'i1',
        key: 'products/p1/a.jpg',
      });
      s3.send.mockRejectedValue(new Error('s3 down'));

      await expect(service.remove('p1', 'i1')).resolves.toBeUndefined();
      expect(prisma.productImage.delete).toHaveBeenCalled();
    });
  });
});
