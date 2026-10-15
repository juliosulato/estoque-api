import 'reflect-metadata';
import {
  type CanActivate,
  type INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { resolveTestDatabase } from './helpers/test-database.js';

// Integration test against a REAL Postgres. It writes data, so it only runs against a
// database explicitly meant for tests (see helpers/test-database.ts).
const { skip } = resolveTestDatabase();

const BASE = '/api/admin/produtos';

describe.skipIf(skip)('Products (integration, real Postgres)', () => {
  let app: INestApplication;
  let prisma: import('../src/prisma/prisma.service.js').PrismaService;
  let categoryId: string;
  const run = Date.now().toString(36);
  const sku = (n: string) => `IT-${run}-${n}`;

  beforeAll(async () => {
    const { AppModule } = await import('../src/app.module.js');
    const { AuthGuard } = await import('../src/auth/auth.guard.js');
    const { PrismaService } = await import('../src/prisma/prisma.service.js');

    const allowAll: CanActivate = { canActivate: () => true };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(AuthGuard)
      .useValue(allowAll)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    categoryId = (
      await prisma.category.create({
        data: { name: `it-${run}`, slug: `it-${run}` },
      })
    ).id;
  });

  afterAll(async () => {
    if (!app) return;
    const where = { sku: { startsWith: `IT-${run}-` } };
    const products = await prisma.product.findMany({
      where,
      select: { id: true },
    });
    const productId = { in: products.map((p) => p.id) };
    await prisma.stockMovement.deleteMany({ where: { productId } });
    await prisma.stock.deleteMany({ where: { productId } });
    await prisma.product.deleteMany({ where });
    await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.user.deleteMany({ where: { email: `it-${run}@example.com` } });
    await app.close();
  });

  const create = (n: string, extra: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post(BASE)
      .send({
        sku: sku(n),
        name: `Product ${n} ${run}`,
        price: 10,
        categoryId,
        ...extra,
      });

  it('answers 409 for a duplicated sku (service pre-check)', async () => {
    await create('dup').expect(201);
    const res = await create('dup', { name: `Other ${run}` }).expect(409);
    expect(res.body.message).toContain('sku');
  });

  it('answers 409 for a duplicated slug and hints at sending an explicit one', async () => {
    await create('slugdup', { slug: `slug-${run}` }).expect(201);
    const res = await create('slugdup2', { slug: `slug-${run}` }).expect(409);
    expect(res.body.message).toContain('slug');
    expect(res.body.message).toContain('explicit "slug"');
  });

  it('trims the sku before saving', async () => {
    const res = await create('trim', { sku: `  ${sku('trim')}  ` }).expect(201);
    expect(res.body.sku).toBe(sku('trim'));
    await create('trimws', { sku: '   ' }).expect(400);
  });

  it('answers 409, not 500, when the unique index itself rejects the sku (real P2002)', async () => {
    await create('p2002').expect(201);

    const { ProductsService } =
      await import('../src/products/products.service.js');
    const prototype = ProductsService.prototype as unknown as {
      ensureSkuAvailable: () => Promise<void>;
    };
    const spy = vi
      .spyOn(prototype, 'ensureSkuAvailable')
      .mockResolvedValue(undefined);
    try {
      const res = await create('p2002', { name: `Another ${run}` }).expect(409);
      expect(res.body.message).toContain('sku');
      expect(res.body).toEqual({
        statusCode: 409,
        error: 'Conflict',
        message: 'A record with this sku already exists',
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('concurrent creates with the same sku yield one 201 and no 500', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        create('race', { name: `Race ${i} ${run}` }),
      ),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(5);
  });

  it('answers 409 when deleting a product that gained a stock movement after the count (real P2003)', async () => {
    const { id } = (await create('p2003').expect(201)).body as { id: string };
    const user = await prisma.user.create({
      data: { name: 'it', email: `it-${run}@example.com` },
    });
    await prisma.stockMovement.create({
      data: { productId: id, userId: user.id, type: 'ENTRY', quantity: 1 },
    });

    const original = prisma.stockMovement.count.bind(prisma.stockMovement);
    prisma.stockMovement.count = (() => Promise.resolve(0)) as never;
    try {
      await request(app.getHttpServer()).delete(`${BASE}/${id}`).expect(409);
    } finally {
      prisma.stockMovement.count = original as never;
    }
    expect(await prisma.product.findUnique({ where: { id } })).not.toBeNull();
  });

  it('answers 400 for PATCH null on a required field and 200 for a nullable one', async () => {
    const { id } = (await create('patch').expect(201)).body as { id: string };
    await request(app.getHttpServer())
      .patch(`${BASE}/${id}`)
      .send({ name: null })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`${BASE}/${id}`)
      .send({ price: null })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`${BASE}/${id}`)
      .send({ description: null, costPrice: null })
      .expect(200);
  });

  it('upserts minStock for a product that has no stock row', async () => {
    const { id } = (await create('nostock').expect(201)).body as { id: string };
    await prisma.stock.deleteMany({ where: { productId: id } });

    const res = await request(app.getHttpServer())
      .patch(`${BASE}/${id}`)
      .send({ minStock: 7 })
      .expect(200);
    expect(res.body.stock).toMatchObject({ quantity: 0, minStock: 7 });
  });

  it('answers 400 for POST with active null', async () => {
    await create('activenull', { active: null }).expect(400);
  });

  it('answers 400 for an empty slug and for a price above Decimal(10,2)', async () => {
    await create('slug', { name: '!!!' }).expect(400);
    await create('big', { price: 100000000 }).expect(400);
  });

  it('answers 400 for a whitespace-only search and trims a padded one', async () => {
    await request(app.getHttpServer()).get(`${BASE}?search=%20%20`).expect(400);
    const res = await request(app.getHttpServer())
      .get(`${BASE}?search=%20${sku('dup')}%20`)
      .expect(200);
    expect(res.body.total).toBe(1);
  });
});
