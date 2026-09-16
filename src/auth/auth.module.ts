import { Module } from '@nestjs/common';
import { authProvider } from './auth.provider.js';
import { AuthGuard } from './auth.guard.js';
import { AUTH_INSTANCE } from './auth.constants.js';

@Module({
  controllers: [],
  providers: [authProvider, AuthGuard],
  exports: [AUTH_INSTANCE, AuthGuard],
})
export class AuthModule {}
