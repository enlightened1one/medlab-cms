import { Injectable, Logger, Global, Module } from '@nestjs/common';
import { AuditOutcome, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  actorId?: string | null; action: string; resourceType: string; resourceId?: string | null;
  outcome?: AuditOutcome; correlationId?: string; metadata?: Prisma.InputJsonValue;
}
/** Append-only. No update/delete methods exist, and no controller exposes any. Never pass secrets or clinical values in metadata. */
@Injectable()
export class AuditService {
  private readonly log = new Logger('Audit');
  constructor(private readonly prisma: PrismaService) {}
  async record(e: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    try {
      await (tx ?? this.prisma).auditLog.create({ data: {
        actorId: e.actorId ?? null, action: e.action, resourceType: e.resourceType, resourceId: e.resourceId ?? null,
        outcome: e.outcome ?? AuditOutcome.SUCCESS, correlationId: e.correlationId, metadata: e.metadata } });
    } catch (err) {
      this.log.error(`audit write failed for action=${e.action}`); // never log metadata
      if (tx) throw err; // inside a transaction a lost audit record must abort the operation
    }
  }
}
@Global() @Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
