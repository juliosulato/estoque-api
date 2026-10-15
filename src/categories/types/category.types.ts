import type { Category, Prisma } from '@prisma/client';

export type CategoryWithRelations = Prisma.CategoryGetPayload<{
  include: { parent: true; children: true };
}>;

export interface CategoryTreeNode extends Category {
  children: CategoryTreeNode[];
}
