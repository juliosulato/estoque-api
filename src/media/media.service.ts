import { randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ProductImage } from '@prisma/client';
import type { EnvConfig } from '../config/env.schema.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ConfirmImageDto } from './dto/confirm-image.dto.js';
import {
  ALLOWED_IMAGE_TYPES,
  type AllowedImageType,
  type PresignImageDto,
} from './dto/presign-image.dto.js';
import type { ReorderImagesDto } from './dto/reorder-images.dto.js';
import { S3_CLIENT } from './s3.provider.js';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_IMAGES_PER_PRODUCT = 10;
const PRESIGN_EXPIRES_IN = 5 * 60;

const EXTENSIONS: Record<AllowedImageType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

export interface PresignResult {
  uploadUrl: string;
  key: string;
  expiresIn: number;
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly bucket: string;
  private readonly publicBaseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    config: ConfigService<EnvConfig, true>,
  ) {
    this.bucket = config.get('S3_BUCKET', { infer: true });
    this.publicBaseUrl = config
      .get('S3_PUBLIC_BASE_URL', { infer: true })
      .replace(/\/+$/, '');
  }

  async presign(
    productId: string,
    dto: PresignImageDto,
  ): Promise<PresignResult> {
    await this.ensureProductExists(productId);

    if (dto.size > MAX_IMAGE_SIZE) {
      throw new BadRequestException(
        `Image exceeds the maximum size of ${MAX_IMAGE_SIZE} bytes`,
      );
    }

    const count = await this.prisma.productImage.count({
      where: { productId },
    });
    if (count >= MAX_IMAGES_PER_PRODUCT) {
      throw new ConflictException(
        `Product already has the maximum of ${MAX_IMAGES_PER_PRODUCT} images`,
      );
    }

    const key = `products/${productId}/${randomUUID()}.${EXTENSIONS[dto.contentType]}`;
    const uploadUrl = await getSignedUrl(
      this.s3,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: dto.contentType,
        ContentLength: dto.size,
      }),
      { expiresIn: PRESIGN_EXPIRES_IN },
    );

    return { uploadUrl, key, expiresIn: PRESIGN_EXPIRES_IN };
  }

  async confirm(
    productId: string,
    dto: ConfirmImageDto,
  ): Promise<ProductImage> {
    if (!dto.key.startsWith(`products/${productId}/`)) {
      throw new BadRequestException('Key does not belong to this product');
    }
    await this.ensureProductExists(productId);

    const existing = await this.prisma.productImage.findFirst({
      where: { key: dto.key },
    });
    if (existing) {
      throw new ConflictException('Image with this key is already registered');
    }

    const head = await this.s3
      .send(new HeadObjectCommand({ Bucket: this.bucket, Key: dto.key }))
      .catch((error: unknown) => {
        if (this.isNotFound(error)) {
          throw new BadRequestException('Uploaded object not found');
        }
        throw error;
      });

    if (
      !ALLOWED_IMAGE_TYPES.includes(head.ContentType as AllowedImageType) ||
      head.ContentLength === undefined ||
      head.ContentLength > MAX_IMAGE_SIZE
    ) {
      throw new BadRequestException('Uploaded object has invalid type or size');
    }

    const { _max } = await this.prisma.productImage.aggregate({
      where: { productId },
      _max: { order: true },
    });

    return this.prisma.productImage.create({
      data: {
        productId,
        key: dto.key,
        url: `${this.publicBaseUrl}/${dto.key}`,
        alt: dto.alt,
        order: (_max.order ?? -1) + 1,
      },
    });
  }

  async reorder(
    productId: string,
    dto: ReorderImagesDto,
  ): Promise<ProductImage[]> {
    await this.ensureProductExists(productId);

    const current = await this.prisma.productImage.findMany({
      where: { productId },
      select: { id: true },
    });
    const currentIds = new Set(current.map((image) => image.id));
    if (
      dto.ids.length !== currentIds.size ||
      !dto.ids.every((id) => currentIds.has(id))
    ) {
      throw new BadRequestException(
        'ids must contain exactly the ids of the product images',
      );
    }

    return this.prisma.$transaction(
      dto.ids.map((id, index) =>
        this.prisma.productImage.update({
          where: { id },
          data: { order: index },
        }),
      ),
    );
  }

  async remove(productId: string, imageId: string): Promise<void> {
    const image = await this.prisma.productImage.findFirst({
      where: { id: imageId, productId },
    });
    if (!image) {
      throw new NotFoundException(
        `Image "${imageId}" not found for product "${productId}"`,
      );
    }

    await this.prisma.productImage.delete({ where: { id: imageId } });

    try {
      await this.s3.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: image.key }),
      );
    } catch (error) {
      this.logger.error(
        `Failed to delete S3 object "${image.key}"`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async ensureProductExists(productId: string): Promise<void> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException(`Product with id "${productId}" not found`);
    }
  }

  private isNotFound(error: unknown): boolean {
    const e = error as {
      name?: string;
      $metadata?: { httpStatusCode?: number };
    };
    return e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
  }
}
