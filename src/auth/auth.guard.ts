import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import { AUTH_INSTANCE } from './auth.constants.js';
import type { Auth } from './auth.options.js';
import type { AuthenticatedRequest } from './types/authenticated-request.type.js';
import type { AuthenticatedUser } from './types/authenticated-user.type.js';
import type { User } from 'better-auth';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(AUTH_INSTANCE) private readonly auth: Auth) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const session = await this.auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });

    if (!session) {
      throw new UnauthorizedException('Invalid or missing session');
    }

    request.user = this.toAuthenticatedUser(session.user);

    return true;
  }

  private toAuthenticatedUser(user: User): AuthenticatedUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
      image: user.image ?? null,
    };
  }
}
