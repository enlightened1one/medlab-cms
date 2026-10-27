import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Permission, Role } from '@medlab/shared-types';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const PERMS = 'permissions';
export const AUTH_ONLY = 'authenticatedOnly';
/** Any valid session may call this route; use sparingly (e.g. /auth/me). */
export const AuthenticatedOnly = () => SetMetadata(AUTH_ONLY, true);
export const RequirePermissions = (...p: Permission[]) => SetMetadata(PERMS, p);

export interface AuthUser { id: string; email: string; role: Role }
export const CurrentUser = createParamDecorator((_d, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);
