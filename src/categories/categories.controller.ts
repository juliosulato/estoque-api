import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { Category } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard.js';
import { CategoriesService } from './categories.service.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';
import { UpdateCategoryDto } from './dto/update-category.dto.js';
import { PaginateCategoryDto } from './dto/paginate-category.dto.js';
import type {
  CategoryTreeNode,
  CategoryWithRelations,
  PaginatedResult,
} from './types/category.types.js';

@UseGuards(AuthGuard)
@Controller('admin/categorias')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) { }

  @Post()
  create(@Body() dto: CreateCategoryDto): Promise<Category> {
    return this.categoriesService.create(dto);
  }

  @Get()
  findAll(@Query() query: PaginateCategoryDto): Promise<PaginatedResult<Category>> {
    return this.categoriesService.findAll(query);
  }

  // Must be declared before the `:id` route below — Nest/Express matches
  // routes in registration order, so if `:id` came first, a request to
  // `/tree` would be captured by `findOne` with id = "tree".
  @Get('tree')
  findTree(): Promise<CategoryTreeNode[]> {
    return this.categoriesService.findTree();
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<CategoryWithRelations> {
    return this.categoriesService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCategoryDto): Promise<Category> {
    return this.categoriesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.categoriesService.remove(id);
  }
}
