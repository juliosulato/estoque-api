import { DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { EnvConfig } from '../config/env.schema.js';
import { S3_CLIENT } from '../media/s3.provider.js';
import type { PaginatedResult } from '../common/types/paginated-result.type.js';
import { generateSlug } from '../common/utils/generate-slug.util.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateProductDto } from './dto/create-product.dto.js';
import type { ListProductsDto } from './dto/list-products.dto.js';
import type { UpdateProductDto } from './dto/update-product.dto.js';
import {
  productDetailInclude,
  productListInclude,
  type ProductDetail,
  type ProductListItem,
} from './types/product.types.js';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {}

  async create(dto: CreateProductDto): Promise<ProductDetail> {
    const slug = this.buildSlug(dto.slug?.trim() || dto.name);
    await this.ensureSkuAvailable(dto.sku);
    await this.ensureSlugAvailable(slug);
    await this.ensureCategoryExists(dto.categoryId);

    return this.prisma.product.create({
      data: {
        sku: dto.sku,
        name: dto.name,
        slug,
        description: dto.description,
        price: dto.price,
        costPrice: dto.costPrice,
        active: dto.active,
        categoryId: dto.categoryId,
        stock: { create: { quantity: 0, minStock: dto.minStock ?? 0 } },
      },
      include: productDetailInclude,
    });
  }

  async findAll(
    query: ListProductsDto,
  ): Promise<PaginatedResult<ProductListItem>> {
    const { page, limit, categoryId, active, search } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ProductWhereInput = {
      ...(categoryId !== undefined && { categoryId }),
      ...(active !== undefined && { active }),
      ...(search !== undefined && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { sku: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: productListInclude,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: string): Promise<ProductDetail> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: productDetailInclude,
    });
    if (!product) {
      throw new NotFoundException(`Product with id "${id}" not found`);
    }
    return product;
  }

  async update(id: string, dto: UpdateProductDto): Promise<ProductDetail> {
    const product = await this.findOne(id);
    const data: Prisma.ProductUncheckedUpdateInput = {
      name: dto.name,
      description: dto.description,
      price: dto.price,
      costPrice: dto.costPrice,
      active: dto.active,
    };

    if (dto.sku !== undefined && dto.sku !== product.sku) {
      await this.ensureSkuAvailable(dto.sku, id);
      data.sku = dto.sku;
    }

    if (dto.slug !== undefined) {
      const slug = this.buildSlug(dto.slug);
      if (slug !== product.slug) {
        await this.ensureSlugAvailable(slug, id);
        data.slug = slug;
      }
    }

    if (dto.categoryId !== undefined && dto.categoryId !== product.categoryId) {
      await this.ensureCategoryExists(dto.categoryId);
      data.categoryId = dto.categoryId;
    }

    if (dto.minStock !== undefined) {
      data.stock = {
        upsert: {
          create: { quantity: 0, minStock: dto.minStock },
          update: { minStock: dto.minStock },
        },
      };
    }

    return this.prisma.product.update({
      where: { id },
      data,
      include: productDetailInclude,
    });
  }

  async remove(id: string): Promise<void> {
    const product = await this.findOne(id);

    const movementCount = await this.prisma.stockMovement.count({
      where: { productId: id },
    });
    if (movementCount > 0) {
      throw new ConflictException(
        `Cannot delete product: it has ${movementCount} stock movement(s). Deactivate it instead (PATCH with "active": false)`,
      );
    }

    await this.prisma.$transaction([
      this.prisma.stock.deleteMany({ where: { productId: id } }),
      this.prisma.product.delete({ where: { id } }),
    ]);

    await this.deleteImageObjects(product.images.map((image) => image.key));
  }

  private async deleteImageObjects(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      const result = await this.s3.send(
        new DeleteObjectsCommand({
          Bucket: this.config.get('S3_BUCKET', { infer: true }),
          Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      if (result.Errors?.length) {
        this.logger.error(
          `Failed to delete S3 objects: ${result.Errors.map((e) => e.Key).join(', ')}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to delete S3 objects: ${keys.join(', ')}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private buildSlug(input: string): string {
    const slug = generateSlug(input);
    if (!slug) {
      throw new BadRequestException(
        'Slug must contain at least one letter or digit',
      );
    }
    return slug;
  }

  private async ensureSkuAvailable(
    sku: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.prisma.product.findUnique({ where: { sku } });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(`Product with sku "${sku}" already exists`);
    }
  }

  private async ensureSlugAvailable(
    slug: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.prisma.product.findUnique({ where: { slug } });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(
        `Product with slug "${slug}" already exists. Send an explicit "slug" to choose a different one`,
      );
    }
  }

  private async ensureCategoryExists(categoryId: string): Promise<void> {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
    });
    if (!category) {
      throw new NotFoundException(`Category with id "${categoryId}" not found`);
    }
  }
}
