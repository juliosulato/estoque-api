import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Prisma } from '@prisma/client';

interface MappedError {
  status: HttpStatus;
  error: string;
  message: string;
}

/**
 * Translates Prisma known-request errors into HTTP responses:
 * P2002 (unique) and P2003 (foreign key) -> 409, P2025 (not found) -> 404.
 * Any other code is a genuine server error and answers 500 without leaking details.
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter<Prisma.PrismaClientKnownRequestError> {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(
    exception: Prisma.PrismaClientKnownRequestError,
    host: ArgumentsHost,
  ): void {
    const mapped = this.map(exception);
    if (mapped.status === HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(`${exception.code}: ${exception.message}`);
    } else if (exception.code === 'P2003') {
      this.logger.warn(
        `P2003 foreign key violation (constraint: ${this.constraintName(exception)})`,
      );
    }

    const { httpAdapter } = this.httpAdapterHost;
    httpAdapter.reply(
      host.switchToHttp().getResponse(),
      {
        statusCode: mapped.status,
        message: mapped.message,
        error: mapped.error,
      },
      mapped.status,
    );
  }

  private map(exception: Prisma.PrismaClientKnownRequestError): MappedError {
    switch (exception.code) {
      case 'P2002': {
        const field = this.conflictingField(exception);
        return {
          status: HttpStatus.CONFLICT,
          error: 'Conflict',
          message: field
            ? `A record with this ${field} already exists`
            : 'A record with these unique values already exists',
        };
      }
      case 'P2003':
        return {
          status: HttpStatus.CONFLICT,
          error: 'Conflict',
          message: 'Operation conflicts with related records',
        };
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          error: 'Not Found',
          message: 'Record not found',
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'Internal Server Error',
          message: 'Internal server error',
        };
    }
  }

  /** Constraint name only, never the user's values; 'unknown' if the adapter shape differs. */
  private constraintName(
    exception: Prisma.PrismaClientKnownRequestError,
  ): string {
    const meta = exception.meta as
      | {
          field_name?: unknown;
          driverAdapterError?: {
            cause?: { constraint?: { index?: unknown; fields?: unknown } };
          };
        }
      | undefined;
    const constraint = meta?.driverAdapterError?.cause?.constraint;
    if (typeof constraint?.index === 'string') return constraint.index;
    if (Array.isArray(constraint?.fields)) {
      return constraint.fields.filter((f) => typeof f === 'string').join(',');
    }
    if (typeof meta?.field_name === 'string') return meta.field_name;
    return 'unknown';
  }

  /**
   * With the pg driver adapter `meta.target` is absent; the only hint is the
   * constraint name Postgres generated, `<table>_<column>_key`. Best-effort:
   * returns undefined for anything that does not match that shape (composite
   * or custom-named constraints), and the caller falls back to a generic message.
   */
  private conflictingField(
    exception: Prisma.PrismaClientKnownRequestError,
  ): string | undefined {
    const meta = exception.meta as
      | {
          driverAdapterError?: {
            cause?: { table?: unknown; constraint?: { index?: unknown } };
          };
        }
      | undefined;
    const cause = meta?.driverAdapterError?.cause;
    const index = cause?.constraint?.index;
    const table = cause?.table;
    if (typeof index !== 'string' || typeof table !== 'string')
      return undefined;

    const prefix = `${table}_`;
    if (!index.startsWith(prefix) || !index.endsWith('_key')) return undefined;
    const column = index.slice(prefix.length, -'_key'.length);
    return /^[A-Za-z][A-Za-z0-9]*$/.test(column) ? column : undefined;
  }
}
