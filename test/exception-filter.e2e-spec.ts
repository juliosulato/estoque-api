import 'reflect-metadata';
import {
  type CanActivate,
  type INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { resolveTestDatabase } from './helpers/test-database.js';

const { skip } = resolveTestDatabase();

async function createApp(allowAll: boolean): Promise<INestApplication> {
  const { AppModule } = await import('../src/app.module.js');
  const { AuthGuard } = await import('../src/auth/auth.guard.js');

  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (allowAll) {
    const guard: CanActivate = { canActivate: () => true };
    builder = builder.overrideGuard(AuthGuard).useValue(guard);
  }
  const app = (await builder.compile()).createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  return app;
}

describe.skipIf(skip)('PrismaExceptionFilter vs HttpException (e2e)', () => {
  let guarded: INestApplication;
  let open: INestApplication;

  beforeAll(async () => {
    guarded = await createApp(false);
    open = await createApp(true);
  });

  afterAll(async () => {
    await guarded?.close();
    await open?.close();
  });

  it('keeps the original 401 message when there is no session', async () => {
    const res = await request(guarded.getHttpServer())
      .get('/api/admin/produtos')
      .expect(401);
    expect(res.body).toMatchObject({
      statusCode: 401,
      message: 'Invalid or missing session',
    });
  });

  it('keeps the original 404 message for a missing product', async () => {
    const res = await request(open.getHttpServer())
      .get('/api/admin/produtos/nope')
      .expect(404);
    expect(res.body).toMatchObject({
      statusCode: 404,
      message: 'Product with id "nope" not found',
    });
  });
});
