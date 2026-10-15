import { Logger, type ArgumentsHost } from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaExceptionFilter } from './prisma-exception.filter.js';

function prismaError(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: 'test',
    meta,
  });
}

// Shape observed from a real P2002 raised through @prisma/adapter-pg.
function uniqueMeta(index: string, table = 'products') {
  return {
    modelName: 'Product',
    driverAdapterError: {
      name: 'DriverAdapterError',
      cause: {
        originalCode: '23505',
        kind: 'UniqueConstraintViolation',
        constraint: { index },
        table,
      },
    },
  };
}

describe('PrismaExceptionFilter', () => {
  const response = {};
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  let reply: ReturnType<typeof vi.fn>;
  let filter: PrismaExceptionFilter;

  beforeEach(() => {
    reply = vi.fn();
    filter = new PrismaExceptionFilter({
      httpAdapter: { reply },
    } as unknown as HttpAdapterHost);
  });

  it('maps P2002 to 409 and names the conflicting field', () => {
    filter.catch(prismaError('P2002', uniqueMeta('products_sku_key')), host);

    expect(reply).toHaveBeenCalledWith(
      response,
      {
        statusCode: 409,
        error: 'Conflict',
        message: 'A record with this sku already exists',
      },
      409,
    );
  });

  it('uses a generic P2002 message when the field cannot be extracted', () => {
    filter.catch(prismaError('P2002'), host);
    filter.catch(
      prismaError('P2002', uniqueMeta('products_sku_slug_key')),
      host,
    );
    filter.catch(prismaError('P2002', uniqueMeta('custom_name')), host);

    for (const call of reply.mock.calls) {
      expect(call[1]).toMatchObject({
        statusCode: 409,
        message: 'A record with these unique values already exists',
      });
    }
  });

  it('maps P2003 to 409', () => {
    filter.catch(prismaError('P2003'), host);

    expect(reply).toHaveBeenCalledWith(
      response,
      expect.objectContaining({ statusCode: 409, error: 'Conflict' }),
      409,
    );
  });

  it('logs a warn with code and constraint name only for P2003, keeping 409', () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    try {
      filter.catch(
        prismaError('P2003', {
          driverAdapterError: {
            cause: { constraint: { index: 'stock_movements_productId_fkey' } },
          },
        }),
        host,
      );

      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0]?.[0]);
      expect(message).toContain('P2003');
      expect(message).toContain('stock_movements_productId_fkey');
      expect(message).not.toContain('boom');
      expect(reply).toHaveBeenCalledWith(
        response,
        expect.objectContaining({ statusCode: 409 }),
        409,
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('falls back to "unknown" when the P2003 constraint cannot be read', () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    try {
      filter.catch(prismaError('P2003'), host);
      expect(String(warn.mock.calls[0]?.[0])).toContain('constraint: unknown');
    } finally {
      warn.mockRestore();
    }
  });

  it('maps P2025 to 404', () => {
    filter.catch(prismaError('P2025'), host);

    expect(reply).toHaveBeenCalledWith(
      response,
      expect.objectContaining({ statusCode: 404, error: 'Not Found' }),
      404,
    );
  });

  it('answers 500 without leaking details for any other code', () => {
    const logger = vi
      .spyOn(
        (filter as unknown as { logger: { error: () => void } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);

    filter.catch(prismaError('P2034'), host);

    expect(reply).toHaveBeenCalledWith(
      response,
      {
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'Internal server error',
      },
      500,
    );
    expect(logger).toHaveBeenCalled();
  });
});
