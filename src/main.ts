import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { json } from 'express';
import { toNodeHandler } from 'better-auth/node';
import { AppModule } from './app.module.js';
import { AUTH_INSTANCE } from './auth/auth.constants.js';
import type { Auth } from './auth/auth.options.js';
import type { EnvConfig } from './config/env.schema.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const auth = app.get<Auth>(AUTH_INSTANCE);

  // better-auth needs the raw, unparsed request body, so its handler is
  // mounted ahead of the global JSON parser — otherwise express.json()
  // would consume the request stream before better-auth can read it.
  app.use('/api/auth', toNodeHandler(auth));
  app.use(json());

  const config = app.get<ConfigService<EnvConfig, true>>(ConfigService);
  await app.listen(config.get('PORT', { infer: true }));
}
await bootstrap();
