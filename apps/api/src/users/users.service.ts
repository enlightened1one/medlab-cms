import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { hashPassword } from '../common/password';
import { CreateUserDto } from './users.dto';

// Explicit select: passwordHash and failedLoginCount can never reach a response.
const SAFE = { id: true, email: true, fullName: true, role: true, isActive: true, lastLoginAt: true, createdAt: true } as const;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async list(page = 1, pageSize = 20) {
    const take = Math.min(Math.max(pageSize, 1), 100), skip = (Math.max(page, 1) - 1) * take;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ select: SAFE, orderBy: { createdAt: 'desc' }, skip, take }), this.prisma.user.count()]);
    return { items, total, page, pageSize: take };
  }

  async create(actorId: string, dto: CreateUserDto, correlationId?: string) {
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email }, select: { id: true } })) throw new ConflictException({ code: 'EMAIL_IN_USE', message: 'An account with this email already exists' });
    const user = await this.prisma.user.create({ data: { email, fullName: dto.fullName.trim(), role: dto.role, passwordHash: await hashPassword(dto.temporaryPassword) }, select: SAFE });
    await this.audit.record({ actorId, action: 'USER_CREATE', resourceType: 'User', resourceId: user.id, correlationId, metadata: { role: dto.role } });
    return user; // unique-constraint race is mapped to 409 by the global filter (P2002)
  }

  private async assertNotLastAdmin(id: string) {
    const target = await this.prisma.user.findUnique({ where: { id }, select: { role: true, isActive: true } });
    if (!target) throw new NotFoundException({ code: 'NOT_FOUND', message: 'User not found' });
    if (target.role === Role.ADMINISTRATOR && target.isActive &&
      (await this.prisma.user.count({ where: { role: Role.ADMINISTRATOR, isActive: true } })) <= 1)
      throw new BadRequestException({ code: 'LAST_ADMIN', message: 'The last active administrator cannot be demoted or deactivated' });
  }

  async setActive(actorId: string, id: string, isActive: boolean, correlationId?: string) {
    if (id === actorId && !isActive) throw new BadRequestException({ code: 'SELF_DEACTIVATION', message: 'You cannot deactivate your own account' });
    if (!isActive) await this.assertNotLastAdmin(id);
    const user = await this.prisma.$transaction(async tx => {
      const u = await tx.user.update({ where: { id }, data: { isActive }, select: SAFE });
      if (!isActive) await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record({ actorId, action: isActive ? 'USER_ACTIVATE' : 'USER_DEACTIVATE', resourceType: 'User', resourceId: id, correlationId }, tx);
      return u;
    });
    return user;
  }

  async setRole(actorId: string, id: string, role: Role, correlationId?: string) {
    if (id === actorId) throw new BadRequestException({ code: 'SELF_ROLE_CHANGE', message: 'You cannot change your own role' });
    if (role !== Role.ADMINISTRATOR) await this.assertNotLastAdmin(id);
    const user = await this.prisma.user.update({ where: { id }, data: { role }, select: SAFE });
    await this.audit.record({ actorId, action: 'USER_ROLE_CHANGE', resourceType: 'User', resourceId: id, correlationId, metadata: { newRole: role } });
    return user;
  }
}
