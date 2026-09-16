import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Category, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { generateSlug } from './utils/generate-slug.util.js';
import type {
  CategoryTreeNode,
  CategoryWithRelations,
  PaginatedResult,
} from './types/category.types.js';
import type { CreateCategoryDto } from './dto/create-category.dto.js';
import type { UpdateCategoryDto } from './dto/update-category.dto.js';
import type { PaginateCategoryDto } from './dto/paginate-category.dto.js';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCategoryDto): Promise<Category> {
    const slug = generateSlug(dto.slug?.trim() || dto.name);
    await this.ensureSlugAvailable(slug);

    if (dto.parentId) {
      await this.ensureParentExists(dto.parentId);
      // A brand-new category has no id yet, so it cannot be anyone's
      // ancestor — cycle detection is unreachable here and only needed
      // on update (see assertNoCycle below).
    }

    return this.prisma.category.create({
      data: { name: dto.name, slug, parentId: dto.parentId ?? null },
    });
  }

  async findAll(query: PaginateCategoryDto): Promise<PaginatedResult<Category>> {
    const { page, limit } = query;
    const skip = (page - 1) * limit;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.category.findMany({ skip, take: limit, orderBy: { name: 'asc' } }),
      this.prisma.category.count(),
    ]);

    return { data, total, page, limit };
  }

  async findTree(): Promise<CategoryTreeNode[]> {
    const categories = await this.prisma.category.findMany({ orderBy: { name: 'asc' } });
    return this.buildTree(categories);
  }

  async findOne(id: string): Promise<CategoryWithRelations> {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: { parent: true, children: true },
    });
    if (!category) {
      throw new NotFoundException(`Category with id "${id}" not found`);
    }
    return category;
  }

  async update(id: string, dto: UpdateCategoryDto): Promise<Category> {
    const category = await this.findOneOrThrow(id);
    const data: Prisma.CategoryUncheckedUpdateInput = {};

    if (dto.name !== undefined) {
      data.name = dto.name;
    }

    // Slug is only touched when explicitly provided — changing `name` alone
    // must NOT silently change the slug (slugs may be referenced externally,
    // e.g. public product URLs; silently rewriting them on a name edit would
    // be a surprising breaking side effect).
    if (dto.slug !== undefined) {
      const slug = generateSlug(dto.slug);
      if (slug !== category.slug) {
        await this.ensureSlugAvailable(slug, id);
        data.slug = slug;
      }
    }

    if (dto.parentId !== undefined && dto.parentId !== category.parentId) {
      if (dto.parentId === id) {
        throw new ConflictException('A category cannot be its own parent');
      }
      await this.ensureParentExists(dto.parentId);
      await this.assertNoCycle(id, dto.parentId);
      data.parentId = dto.parentId;
    }

    return this.prisma.category.update({ where: { id }, data });
  }

  async remove(id: string): Promise<void> {
    await this.findOneOrThrow(id);

    const productCount = await this.prisma.product.count({ where: { categoryId: id } });
    if (productCount > 0) {
      throw new ConflictException(
        `Cannot delete category: ${productCount} product(s) are linked to it`,
      );
    }

    const childrenCount = await this.prisma.category.count({ where: { parentId: id } });
    if (childrenCount > 0) {
      throw new ConflictException(
        `Cannot delete category: it has ${childrenCount} child categor${childrenCount === 1 ? 'y' : 'ies'}`,
      );
    }

    await this.prisma.category.delete({ where: { id } });
  }

  private async findOneOrThrow(id: string): Promise<Category> {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) {
      throw new NotFoundException(`Category with id "${id}" not found`);
    }
    return category;
  }

  private async ensureSlugAvailable(slug: string, excludeId?: string): Promise<void> {
    const existing = await this.prisma.category.findUnique({ where: { slug } });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(`Category with slug "${slug}" already exists`);
    }
  }

  private async ensureParentExists(parentId: string): Promise<void> {
    const parent = await this.prisma.category.findUnique({ where: { id: parentId } });
    if (!parent) {
      throw new NotFoundException(`Parent category with id "${parentId}" not found`);
    }
  }

  /**
   * Prevents a cycle: verifies that walking up the ancestor chain starting
   * at `candidateParentId` never reaches `categoryId` again. If it did,
   * `categoryId` would be an ancestor of `candidateParentId` — meaning
   * `candidateParentId` is one of `categoryId`'s own descendants, and
   * assigning it as the new parent would create a cycle in the tree.
   *
   * Only relevant on update (see create() for why it's unreachable there).
   * Loads the whole (id, parentId) column pair once, then the ancestor walk
   * happens in memory against a Map — a single round trip regardless of
   * tree depth, no recursive SQL/CTE needed given the expected small size
   * of an admin category tree.
   */
  private async assertNoCycle(categoryId: string, candidateParentId: string): Promise<void> {
    const all = await this.prisma.category.findMany({ select: { id: true, parentId: true } });
    const parentById = new Map(all.map((c) => [c.id, c.parentId]));

    let currentId: string | null = candidateParentId;
    const visited = new Set<string>();

    while (currentId !== null) {
      if (currentId === categoryId) {
        throw new ConflictException(
          'Cannot set parent: the chosen parent is a descendant of this category (would create a cycle)',
        );
      }
      // Defensive guard only: the chain is finite and kept acyclic by this
      // very check on every prior update, so this should never trigger —
      // it just bounds the walk against any future bypass of that invariant
      // (e.g. a direct DB write) instead of looping forever.
      if (visited.has(currentId)) break;
      visited.add(currentId);
      currentId = parentById.get(currentId) ?? null;
    }
  }

  private buildTree(categories: Category[]): CategoryTreeNode[] {
    const nodeById = new Map<string, CategoryTreeNode>(
      categories.map((category) => [category.id, { ...category, children: [] }]),
    );
    const roots: CategoryTreeNode[] = [];

    for (const category of categories) {
      const node = nodeById.get(category.id);
      if (!node) continue;
      const parentNode = category.parentId ? nodeById.get(category.parentId) : undefined;
      if (parentNode) {
        parentNode.children.push(node);
      } else {
        // Also covers a defensive fallback for an orphaned parentId
        // (shouldn't happen given the FK, but fails safe as a root instead
        // of silently dropping the row from the response).
        roots.push(node);
      }
    }

    return roots;
  }
}
