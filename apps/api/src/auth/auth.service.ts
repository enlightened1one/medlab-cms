import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { hashPassword, verifyPassword } from '../common/password';
import { AuditOutcome } from '@prisma/client';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const MAX_FAILS = 5, LOCK_MIN = 15, RESET_MIN = 30;
const INVALID = () => new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
let DUMMY_HASH: Promise<string> | undefined; // equalises timing for unknown emails

export interface Tokens { accessToken: string; refreshToken: string; refreshExpires: Date }
const pub = (u: { id: string; email: string; fullName: string; role: string }) => ({ id: u.id, email: u.email, fullName: u.fullName, role: u.role });

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService, private cfg: ConfigService, private audit: AuditService, private mail: MailService) {}

  private async issue(user: { id: string; role: string }, familyId: string = randomUUID()): Promise<Tokens & { id: string }> {
    const accessToken = await this.jwt.signAsync({ sub: user.id, role: user.role });
    const refreshToken = randomBytes(48).toString('base64url');
    const refreshExpires = new Date(Date.now() + this.cfg.get<number>('REFRESH_TOKEN_TTL_DAYS')! * 86_400_000);
    const row = await this.prisma.refreshToken.create({ data: { userId: user.id, familyId, tokenHash: sha256(refreshToken), expiresAt: refreshExpires } });
    return { accessToken, refreshToken, refreshExpires, id: row.id };
  }

  async login(email: string, password: string, correlationId?: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    const deny = async (reason: string, actorId?: string): Promise<never> => {
      await this.audit.record({ actorId, action: 'AUTH_LOGIN', resourceType: 'User', resourceId: actorId, outcome: AuditOutcome.FAILURE, correlationId, metadata: { reason } });
      throw INVALID(); // identical response for every failure cause: no account enumeration
    };
    if (!user) { DUMMY_HASH ??= hashPassword('dummy-password-for-timing'); await verifyPassword(await DUMMY_HASH, password); return deny('unknown_user'); }
    if (!user.isActive) return deny('inactive', user.id);
    if (user.lockedUntil && user.lockedUntil > new Date()) return deny('locked', user.id);
    if (!(await verifyPassword(user.passwordHash, password))) {
      const fails = user.failedLoginCount + 1;
      await this.prisma.user.update({ where: { id: user.id }, data: fails >= MAX_FAILS ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MIN * 60_000) } : { failedLoginCount: fails } });
      return deny('bad_password', user.id);
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
    const tokens = await this.issue(user);
    await this.audit.record({ actorId: user.id, action: 'AUTH_LOGIN', resourceType: 'User', resourceId: user.id, correlationId });
    return { tokens, user: pub(user) };
  }

  /** Rotates the refresh token. Presenting an already-rotated token revokes the whole family (theft detection). */
  async refresh(presented: string | undefined, correlationId?: string) {
    const expired = (code: string) => new UnauthorizedException({ code, message: 'Session expired' });
    if (!presented) throw expired('REFRESH_MISSING');
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(presented) }, include: { user: true } });
    if (!row) throw expired('REFRESH_INVALID');
    const revokeFamily = () => this.prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (row.revokedAt) {
      await revokeFamily();
      await this.audit.record({ actorId: row.userId, action: 'AUTH_REFRESH_REUSE', resourceType: 'User', resourceId: row.userId, outcome: AuditOutcome.DENIED, correlationId });
      throw expired('REFRESH_REUSED');
    }
    if (row.expiresAt < new Date() || !row.user.isActive) throw expired('REFRESH_EXPIRED');
    const claimed = await this.prisma.refreshToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date() } }); // atomic: one racer wins
    if (claimed.count !== 1) { await revokeFamily(); throw expired('REFRESH_REUSED'); }
    const next = await this.issue(row.user, row.familyId);
    await this.prisma.refreshToken.update({ where: { id: row.id }, data: { replacedById: next.id } });
    return { tokens: next, user: pub(row.user) };
  }

  async logout(presented?: string) {
    if (!presented) return;
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(presented) } });
    if (row) await this.prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /** Always resolves identically, whether or not the account exists or email delivery works. */
  async forgotPassword(email: string, correlationId?: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!user || !user.isActive) return;
    const token = randomBytes(32).toString('base64url');
    await this.prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_MIN * 60_000) } });
    await this.mail.sendPasswordReset(user.email, `${this.cfg.get('FRONTEND_URL')}/reset-password?token=${token}`);
    await this.audit.record({ actorId: user.id, action: 'AUTH_PASSWORD_RESET_REQUEST', resourceType: 'User', resourceId: user.id, correlationId });
  }

  async resetPassword(token: string, newPassword: string, correlationId?: string) {
    const bad = () => new UnauthorizedException({ code: 'RESET_TOKEN_INVALID', message: 'Reset link is invalid or has expired' });
    const row = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.usedAt || row.expiresAt < new Date()) throw bad();
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.$transaction(async tx => {
      const used = await tx.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
      if (used.count !== 1) throw bad();
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash, failedLoginCount: 0, lockedUntil: null } });
      await tx.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } }); // end all sessions
      await this.audit.record({ actorId: row.userId, action: 'AUTH_PASSWORD_RESET', resourceType: 'User', resourceId: row.userId, correlationId }, tx);
    });
  }
}
