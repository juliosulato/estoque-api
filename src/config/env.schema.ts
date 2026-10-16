import { z } from 'zod';

export const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  SHADOW_DATABASE_URL: z.string().optional(),
  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_URL: z.string().min(1),
  SEED_ADMIN_EMAIL: z.string().min(1),
  SEED_ADMIN_PASSWORD: z.string().min(8),
  SEED_ADMIN_NAME: z.string().min(1).default('Admin'),
  S3_BUCKET: z.string().min(1),
  S3_REGION: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_PUBLIC_BASE_URL: z.string().min(1),
  S3_ENDPOINT: z.string().min(1).optional(),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validate(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    throw new Error(
      `Invalid environment variables:\n${result.error.toString()}`,
    );
  }

  return result.data;
}
