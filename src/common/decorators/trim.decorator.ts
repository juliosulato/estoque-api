import { Transform } from 'class-transformer';

/** Trims string values before validation; non-strings pass through untouched. */
export const Trim = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );
