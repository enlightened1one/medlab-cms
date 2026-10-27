import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/decorators';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(cfg: ConfigService, private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([req => req?.cookies?.access_token ?? null, ExtractJwt.fromAuthHeaderAsBearerToken()]),
      secretOrKey: cfg.getOrThrow('JWT_ACCESS_SECRET'), ignoreExpiration: false, algorithms: ['HS256'],
    });
  }
  /** Role is re-read from the database on every request, so deactivation and role changes apply immediately. */
  async validate(payload: { sub: string }): Promise<AuthUser> {
    const u = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, email: true, role: true, isActive: true } });
    if (!u || !u.isActive) throw new UnauthorizedException({ code: 'ACCOUNT_INACTIVE', message: 'Session is no longer valid' });
    return { id: u.id, email: u.email, role: u.role };
  }
}
