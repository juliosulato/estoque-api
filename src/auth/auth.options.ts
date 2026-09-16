import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { admin } from 'better-auth/plugins/admin';
import type { PrismaClient } from '@prisma/client';

export interface AuthConfigParams {
  prisma: PrismaClient;
  secret: string;
  baseURL: string;
}

export function createAuth({ prisma, secret, baseURL }: AuthConfigParams) {
  return betterAuth({
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    secret,
    baseURL,
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
    },
    plugins: [admin()],
  });
}

export type Auth = ReturnType<typeof createAuth>;
