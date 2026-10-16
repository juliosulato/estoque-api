import { describe, expect, it } from 'vitest';
import { validate } from './env.schema.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  BETTER_AUTH_SECRET: 'secret',
  BETTER_AUTH_URL: 'http://localhost:3000',
  SEED_ADMIN_EMAIL: 'a@example.com',
  SEED_ADMIN_PASSWORD: 'password123',
  S3_BUCKET: 'bucket',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'id',
  S3_SECRET_ACCESS_KEY: 'secret',
  S3_PUBLIC_BASE_URL: 'https://cdn.example.com',
};

describe('env schema S3_PUBLIC_BASE_URL', () => {
  it('strips trailing slashes', () => {
    const env = validate({
      ...base,
      S3_PUBLIC_BASE_URL: 'https://cdn.example.com/media//',
    });
    expect(env.S3_PUBLIC_BASE_URL).toBe('https://cdn.example.com/media');
  });

  it('rejects values that are not URLs', () => {
    expect(() =>
      validate({ ...base, S3_PUBLIC_BASE_URL: 'cdn.example.com' }),
    ).toThrow(/Invalid environment variables/);
  });
});
