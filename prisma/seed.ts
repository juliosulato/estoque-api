import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createAuth } from '../src/auth/auth.options.js';
import { validate } from '../src/config/env.schema.js';

async function main() {
  const env = validate(process.env as Record<string, unknown>);

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });

  const existing = await prisma.user.findUnique({ where: { email: env.SEED_ADMIN_EMAIL } });

  if (existing) {
    console.log(`Admin user already exists: ${env.SEED_ADMIN_EMAIL}`);
    await prisma.$disconnect();
    return;
  }

  const auth = createAuth({
    prisma,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
  });

  // Calling createUser without `headers`/`request` skips the admin plugin's
  // session check (it only enforces authorization for real HTTP requests),
  // which is what lets this bootstrap the first admin with sign-up disabled.
  await auth.api.createUser({
    body: {
      email: env.SEED_ADMIN_EMAIL,
      password: env.SEED_ADMIN_PASSWORD,
      name: env.SEED_ADMIN_NAME,
      role: 'admin',
    },
  });

  console.log(`Admin user created: ${env.SEED_ADMIN_EMAIL}`);
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
