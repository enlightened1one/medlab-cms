import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { hasPermission } from '@medlab/shared-types';
import { AUTH_ONLY, IS_PUBLIC, PERMS } from './decorators';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) { super(); }
  canActivate(ctx: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    return super.canActivate(ctx);
  }
}

/** Deny by default: an authenticated route with no @RequirePermissions is forbidden, not open. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const required = this.reflector.getAllAndOverride<string[]>(PERMS, [ctx.getHandler(), ctx.getClass()]);
    const user = ctx.switchToHttp().getRequest().user; // role comes from the DB-backed JWT strategy, never from the request body
    if (user && this.reflector.getAllAndOverride<boolean>(AUTH_ONLY, [ctx.getHandler(), ctx.getClass()])) return true;
    if (!required?.length || !user) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Access denied' });
    if (!required.every(p => hasPermission(user.role, p as never))) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Access denied' });
    return true;
  }
}

/** CSRF defence for cookie auth: SameSite=Strict cookies PLUS an Origin allow-list check on unsafe methods. */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowed: string[];
  constructor(cfg: ConfigService) { this.allowed = String(cfg.get('CORS_ORIGINS')).split(',').map(s => s.trim()); }
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
    const origin = req.headers.origin as string | undefined;
    if (!origin || !this.allowed.includes(origin)) throw new ForbiddenException({ code: 'CSRF_REJECTED', message: 'Request origin not allowed' });
    return true;
  }
}
