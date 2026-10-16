import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MovementType, type StockMovement } from '@prisma/client';
import type { PaginationDto } from '../common/dto/pagination.dto.js';
import type { PaginatedResult } from '../common/types/paginated-result.type.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateMovementDto } from './dto/create-movement.dto.js';
import type { MovementResult } from './types/stock.types.js';

@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  async createMovement(
    productId: string,
    userId: string,
    dto: CreateMovementDto,
  ): Promise<MovementResult> {
    const { type, quantity, reason } = dto;

    return this.prisma.$transaction(async (tx) => {
      await this.ensureProductExists(tx, productId);

      if (type === MovementType.ENTRY) {
        await tx.stock.update({
          where: { productId },
          data: { quantity: { increment: quantity } },
        });
      } else {
        // Atomic check-and-decrement: the balance guard lives in the UPDATE itself.
        const { count } = await tx.stock.updateMany({
          where: { productId, quantity: { gte: quantity } },
          data: { quantity: { decrement: quantity } },
        });
        if (count === 0) {
          throw new ConflictException('Insufficient stock for this exit');
        }
      }

      const movement = await tx.stockMovement.create({
        data: { productId, userId, type, quantity, reason },
      });
      const stock = await tx.stock.findUniqueOrThrow({
        where: { productId },
        select: { quantity: true, minStock: true },
      });

      return { movement, stock };
    });
  }

  async findMovements(
    productId: string,
    query: PaginationDto,
  ): Promise<PaginatedResult<StockMovement>> {
    const { page, limit } = query;
    await this.ensureProductExists(this.prisma, productId);

    const where = { productId };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.stockMovement.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.stockMovement.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  private async ensureProductExists(
    client: Pick<PrismaService, 'product'>,
    productId: string,
  ): Promise<void> {
    const product = await client.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException(`Product with id "${productId}" not found`);
    }
  }
}
