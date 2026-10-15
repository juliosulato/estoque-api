export interface TestDatabase {
  url: string | undefined;
  skip: boolean;
}

/**
 * Guards specs that write to a real Postgres. Returns `skip: true` when
 * TEST_DATABASE_URL is absent, throws when it is malformed or its database
 * name lacks "test", and otherwise points DATABASE_URL at it so the app never
 * touches the database from .env.
 */
export function resolveTestDatabase(): TestDatabase {
  const url = process.env.TEST_DATABASE_URL?.trim();
  if (!url) return { url: undefined, skip: true };

  let databaseName: string;
  try {
    databaseName = new URL(url).pathname;
  } catch {
    throw new Error('TEST_DATABASE_URL is not a valid connection URL');
  }
  if (!/test/i.test(databaseName)) {
    throw new Error(
      'TEST_DATABASE_URL must point to a database whose name contains "test"',
    );
  }

  process.env.DATABASE_URL = url;
  return { url, skip: false };
}
