import type { Prisma } from '@prisma/client';

export const productListInclude = {
  category: { select: { id: true, name: true } },
  stock: { select: { quantity: true, minStock: true } },
} satisfies Prisma.ProductInclude;

export const productDetailInclude = {
  category: true,
  stock: true,
  images: { orderBy: { order: 'asc' } },
} satisfies Prisma.ProductInclude;

export type ProductListItem = Prisma.ProductGetPayload<{
  include: typeof productListInclude;
}>;

export type ProductDetail = Prisma.ProductGetPayload<{
  include: typeof productDetailInclude;
}>;
