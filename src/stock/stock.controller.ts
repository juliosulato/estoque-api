import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type.js';
import { PaginationDto } from '../common/dto/pagination.dto.js';
import type { PaginatedResult } from '../common/types/paginated-result.type.js';
import type { StockMovement } from '@prisma/client';
import { CreateMovementDto } from './dto/create-movement.dto.js';
import { StockService } from './stock.service.js';
import type { MovementResult } from './types/stock.types.js';

@UseGuards(AuthGuard)
@Controller('admin/produtos/:id/movimentacoes')
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Post()
  create(
    @Param('id') id: string,
    @Body() dto: CreateMovementDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<MovementResult> {
    return this.stockService.createMovement(id, req.user.id, dto);
  }

  @Get()
  findAll(
    @Param('id') id: string,
    @Query() query: PaginationDto,
  ): Promise<PaginatedResult<StockMovement>> {
    return this.stockService.findMovements(id, query);
  }
}
