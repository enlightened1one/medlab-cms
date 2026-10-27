import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePatientDto, UpdatePatientDto } from './patients.dto';

const SAFE = {
  id: true, patientNumber: true, firstName: true, lastName: true, gender: true,
  dateOfBirth: true, phone: true, archivedAt: true, createdAt: true, updatedAt: true,
} as const;

const identityKeyFor = (p: { firstName: string; lastName: string; dateOfBirth?: string | Date | null; phone?: string | null }) => {
  if (!p.dateOfBirth || !p.phone?.trim()) return null;
  const dob = p.dateOfBirth instanceof Date ? p.dateOfBirth.toISOString().slice(0, 10) : p.dateOfBirth.slice(0, 10);
  return createHash('sha256')
    .update([p.lastName, p.firstName, dob, p.phone].map(value => value.trim().toLowerCase()).join('|'))
    .digest('hex');
};

const pageParams = (page?: number, pageSize?: number) => {
  const size = Math.min(Math.max(Number.isInteger(pageSize) ? pageSize! : 20, 1), 100);
  const current = Math.max(Number.isInteger(page) ? page! : 1, 1);
  return { page: current, pageSize: size, skip: (current - 1) * size };
};

@Injectable()
export class PatientsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private async nextPatientNumber(tx: Prisma.TransactionClient) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('medlab:patient-number')::bigint)`;
    const numbers = await tx.patient.findMany({ where: { patientNumber: { startsWith: 'MLP-' } }, select: { patientNumber: true } });
    const maximum = numbers.reduce((max, row) => {
      const suffix = Number(row.patientNumber.slice(4));
      return Number.isSafeInteger(suffix) ? Math.max(max, suffix) : max;
    }, 0);
    return `MLP-${String(maximum + 1).padStart(6, '0')}`;
  }

  async list(user: AuthUser, query: { search?: string; page?: number; pageSize?: number; includeArchived?: string }) {
    const { page, pageSize, skip } = pageParams(query.page, query.pageSize);
    const search = query.search?.trim();
    const where: Prisma.PatientWhereInput = {
      ...(query.includeArchived === 'true' && user.role === Role.ADMINISTRATOR ? {} : { archivedAt: null }),
      ...(search ? { OR: [
        { patientNumber: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ] } : {}),
      // Clinicians need the minimal patient directory to place their first request; histories remain owner-scoped.
    };
    const select = user.role === Role.CLINICIAN
      ? { id: true, patientNumber: true, firstName: true, lastName: true, gender: true, dateOfBirth: true, createdAt: true } as const
      : SAFE;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.patient.findMany({ where, select, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }], skip, take: pageSize }),
      this.prisma.patient.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async get(id: string, user: AuthUser) {
    const select = user.role === Role.CLINICIAN
      ? { id: true, patientNumber: true, firstName: true, lastName: true, gender: true, dateOfBirth: true, createdAt: true } as const
      : SAFE;
    const patient = await this.prisma.patient.findUnique({ where: { id, ...(user.role === Role.CLINICIAN ? { archivedAt: null } : {}) }, select });
    if (!patient) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Patient not found' });
    return patient;
  }

  async create(user: AuthUser, dto: CreatePatientDto, correlationId?: string) {
    const input = {
      firstName: dto.firstName.trim(), lastName: dto.lastName.trim(),
      gender: dto.gender, dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null, phone: dto.phone?.trim() || null,
    };
    const identityKey = identityKeyFor(input);
    if (identityKey && await this.prisma.patient.findUnique({ where: { identityKey }, select: { id: true } }))
      throw new ConflictException({ code: 'POSSIBLE_DUPLICATE_PATIENT', message: 'A patient with these identifying details already exists' });

    return this.prisma.$transaction(async tx => {
      const patient = await tx.patient.create({
        data: { ...input, identityKey, patientNumber: await this.nextPatientNumber(tx), createdById: user.id },
        select: SAFE,
      });
      await this.audit.record({ actorId: user.id, action: 'PATIENT_CREATE', resourceType: 'Patient', resourceId: patient.id, correlationId }, tx);
      return patient;
    });
  }

  async update(id: string, user: AuthUser, dto: UpdatePatientDto, correlationId?: string) {
    const current = await this.prisma.patient.findUnique({ where: { id }, select: { ...SAFE, createdById: true } });
    if (!current)
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Patient not found' });
    if (current.archivedAt) throw new ConflictException({ code: 'PATIENT_ARCHIVED', message: 'Archived patients cannot be edited' });
    const next = {
      firstName: dto.firstName?.trim() ?? current.firstName,
      lastName: dto.lastName?.trim() ?? current.lastName,
      dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : current.dateOfBirth,
      phone: dto.phone === undefined ? current.phone : dto.phone.trim() || null,
    };
    const identityKey = identityKeyFor(next);
    if (identityKey && await this.prisma.patient.findFirst({ where: { identityKey, id: { not: id } }, select: { id: true } }))
      throw new ConflictException({ code: 'POSSIBLE_DUPLICATE_PATIENT', message: 'A patient with these identifying details already exists' });
    return this.prisma.$transaction(async tx => {
      const patient = await tx.patient.update({
        where: { id },
        data: {
          firstName: next.firstName, lastName: next.lastName, dateOfBirth: next.dateOfBirth,
          phone: next.phone, gender: dto.gender ?? current.gender, identityKey,
        },
        select: SAFE,
      });
      await this.audit.record({ actorId: user.id, action: 'PATIENT_UPDATE', resourceType: 'Patient', resourceId: id, correlationId }, tx);
      return patient;
    });
  }

  async archive(id: string, user: AuthUser, correlationId?: string) {
    const patient = await this.prisma.patient.findUnique({ where: { id }, select: { id: true, archivedAt: true } });
    if (!patient) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Patient not found' });
    if (patient.archivedAt) return { id, archivedAt: patient.archivedAt };
    return this.prisma.$transaction(async tx => {
      const updated = await tx.patient.update({ where: { id }, data: { archivedAt: new Date() }, select: { id: true, archivedAt: true } });
      await this.audit.record({ actorId: user.id, action: 'PATIENT_ARCHIVE', resourceType: 'Patient', resourceId: id, correlationId }, tx);
      return updated;
    });
  }

  async history(id: string, user: AuthUser, page = 1, pageSize = 20) {
    const scoped = await this.prisma.patient.findFirst({
      where: { id, ...(user.role === Role.CLINICIAN ? { requests: { some: { requestedById: user.id } } } : {}) },
      select: { id: true },
    });
    if (!scoped) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Patient not found' });
    const { page: current, pageSize: size, skip } = pageParams(page, pageSize);
    const where: Prisma.LaboratoryRequestWhereInput = { patientId: id, ...(user.role === Role.CLINICIAN ? { requestedById: user.id } : {}) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.laboratoryRequest.findMany({
        where, orderBy: { requestDate: 'desc' }, skip, take: size,
        select: {
          id: true, requestNumber: true, status: true, priority: true, requestDate: true, clinicalNotes: user.role === Role.CLINICIAN,
          items: { select: { id: true, test: { select: { code: true, name: true, unit: true } }, result: {
            where: user.role === Role.CLINICIAN ? { status: { in: ['VALIDATED', 'AMENDED'] } } : {},
            select: { id: true, numericValue: true, textValue: true, unit: true, flag: true, status: true, refLow: true, refHigh: true, refText: true },
          } } },
          specimens: { select: { specimenNumber: true, specimenType: true, status: true, collectedAt: true, receivedAt: true } },
          report: { select: { reportNumber: true, status: true, issuedAt: true, version: true } },
        },
      }),
      this.prisma.laboratoryRequest.count({ where }),
    ]);
    return { items, total, page: current, pageSize: size };
  }

}
