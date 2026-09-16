import { ConfigService } from '@nestjs/config';
import type { Provider } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { createAuth } from './auth.options.js';
import { AUTH_INSTANCE } from './auth.constants.js';
import type { EnvConfig } from '../config/env.schema.js';

export const authProvider: Provider = {
  provide: AUTH_INSTANCE,
  inject: [PrismaService, ConfigService],
  useFactory: (prisma: PrismaService, config: ConfigService<EnvConfig, true>) =>
    createAuth({
      prisma,
      secret: config.get('BETTER_AUTH_SECRET', { infer: true }),
      baseURL: config.get('BETTER_AUTH_URL', { infer: true }),
    }),
};
