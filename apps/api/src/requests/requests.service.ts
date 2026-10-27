import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RequestStatus, Role, SpecimenStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRequestDto, UpdateRequestStatusDto } from './requests.dto';

const REQUEST_TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  PENDING: ['SPECIMEN_COLLECTED', 'CANCELLED'],
  SPECIMEN_COLLECTED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['AWAITING_VALIDATION', 'CANCELLED'],
  AWAITING_VALIDATION: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};
const pageParams = (page?: number, pageSize?: number) => {
  const size = Math.min(Math.max(Number.isInteger(pageSize) ? pageSize! : 20, 1), 100);
  const current = Math.max(Number.isInteger(page) ? page! : 1, 1);
  return { page: current, pageSize: size, skip: (current - 1) * size };
};
const resultSelect = (role: Role) => ({
  id: true, numericValue: true, textValue: true, unit: true, flag: true, status: true,
  refLow: true, refHigh: true, refText: true, enteredAt: true, validatedAt: true,
  ...(role === Role.CLINICIAN ? { where: { status: { in: ['VALIDATED', 'AMENDED'] as const } } } : {}),
});

@Injectable()
export class RequestsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async list(user: AuthUser, page = 1, pageSize = 20, status?: RequestStatus) {
    const { page: current, pageSize: size, skip } = pageParams(page, pageSize);
    const where: Prisma.LaboratoryRequestWhereInput = {
      ...(user.role === Role.CLINICIAN ? { requestedById: user.id } : {}),
      ...(status ? { status } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.laboratoryRequest.findMany({
        where, orderBy: { requestDate: 'desc' }, skip, take: size,
        include: {
          patient: { select: { id: true, patientNumber: true, firstName: true, lastName: true, gender: true, dateOfBirth: true } },
          requestedBy: { select: { id: true, fullName: true, role: true } },
          items: { include: { test: { select: { id: true, code: true, name: true, unit: true, resultType: true } }, result: { select: resultSelect(user.role) } } },
          specimens: { select: { id: true, specimenNumber: true, specimenType: true, status: true } },
          report: { select: { id: true, reportNumber: true, status: true, issuedAt: true, version: true } },
        },
      }),
      this.prisma.laboratoryRequest.count({ where }),
    ]);
    return { items, total, page: current, pageSize: size };
  }

  async get(id: string, user: AuthUser) {
    const request = await this.prisma.laboratoryRequest.findFirst({
      where: { id, ...(user.role === Role.CLINICIAN ? { requestedById: user.id } : {}) },
      include: {
        patient: { select: { id: true, patientNumber: true, firstName: true, lastName: true, gender: true, dateOfBirth: true } },
        requestedBy: { select: { id: true, fullName: true, role: true } },
        items: { include: { test: { include: { referenceRanges: true } }, result: { select: resultSelect(user.role) } } },
        specimens: { include: { history: { orderBy: { createdAt: 'asc' }, select: { fromStatus: true, toStatus: true, note: true, createdAt: true, changedBy: { select: { fullName: true } } } } } },
        report: { select: { id: true, reportNumber: true, status: true, issuedAt: true, version: true } },
      },
    });
    if (!request) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Request not found' });
    return request;
  }

  async create(user: AuthUser, dto: CreateRequestDto, idempotencyKey?: string, correlationId?: string) {
    if (!idempotencyKey?.trim() || idempotencyKey.length > 100)
      throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'A valid Idempotency-Key header is required' });
    const existing = await this.prisma.laboratoryRequest.findUnique({
      where: { idempotencyKey }, select: { id: true, requestedById: true },
    });
    if (existing) {
      if (existing.requestedById !== user.id) throw new ConflictException({ code: 'IDEMPOTENCY_KEY_IN_USE', message: 'This idempotency key is already in use' });
      return this.get(existing.id, user);
    }

    const patient = await this.prisma.patient.findUnique({ where: { id: dto.patientId }, select: { id: true, archivedAt: true } });
    if (!patient || patient.archivedAt) throw new NotFoundException({ code: 'PATIENT_NOT_AVAILABLE', message: 'Patient not found or archived' });
    const uniqueTestIds = [...new Set(dto.testIds)];
    if (uniqueTestIds.length !== dto.testIds.length) throw new BadRequestException({ code: 'DUPLICATE_TEST', message: 'A test may only be added once per request' });
    const tests = await this.prisma.laboratoryTest.findMany({
      where: { id: { in: uniqueTestIds }, isActive: true },
      select: { id: true, specimenType: true },
    });
    if (tests.length !== uniqueTestIds.length) throw new BadRequestException({ code: 'INVALID_TESTS', message: 'One or more tests are unavailable' });
    const year = new Date().getUTCFullYear();

    try {
      const requestId = await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`medlab:request:${year}`})::bigint)`;
        const existingNumbers = await tx.laboratoryRequest.findMany({
          where: { requestNumber: { startsWith: `REQ-${year}-` } }, select: { requestNumber: true },
        });
        const next = existingNumbers.reduce((max, row) => Math.max(max, Number(row.requestNumber.split('-').at(-1)) || 0), 0) + 1;
        const requestNumber = `REQ-${year}-${String(next).padStart(4, '0')}`;
        const created = await tx.laboratoryRequest.create({
          data: {
            requestNumber, idempotencyKey, patientId: patient.id, requestedById: user.id,
            priority: dto.priority, clinicalNotes: dto.clinicalNotes?.trim(),
            items: { create: uniqueTestIds.map(testId => ({ testId })) },
          },
        });
        const specimenTypes = [...new Set(tests.map(test => test.specimenType))];
        for (const specimenType of specimenTypes) {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`medlab:specimen:${year}`})::bigint)`;
          const existingSpecimens = await tx.specimen.findMany({
            where: { specimenNumber: { startsWith: `SPC-${year}-` } }, select: { specimenNumber: true },
          });
          const specimenNext = existingSpecimens.reduce((max, row) => Math.max(max, Number(row.specimenNumber.split('-').at(-1)) || 0), 0) + 1;
          await tx.specimen.create({
            data: {
              specimenNumber: `SPC-${year}-${String(specimenNext).padStart(4, '0')}`,
              requestId: created.id, patientId: patient.id, specimenType,
            },
          });
        }
        await this.audit.record({ actorId: user.id, action: 'REQUEST_CREATE', resourceType: 'LaboratoryRequest', resourceId: created.id, correlationId }, tx);
        return created.id;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return this.get(requestId, user);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const duplicate = await this.prisma.laboratoryRequest.findUnique({ where: { idempotencyKey }, select: { id: true, requestedById: true } });
        if (duplicate?.requestedById === user.id) return this.get(duplicate.id, user);
      }
      throw error;
    }
  }

  async transition(id: string, user: AuthUser, dto: UpdateRequestStatusDto, correlationId?: string) {
    if (dto.status === RequestStatus.CANCELLED && user.role === Role.CLINICIAN)
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Clinicians cannot cancel requests' });
    const current = await this.prisma.laboratoryRequest.findFirst({
      where: { id, ...(user.role === Role.CLINICIAN ? { requestedById: user.id } : {}) },
      select: { status: true, version: true },
    });
    if (!current) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Request not found' });
    if (current.version !== dto.expectedVersion) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Request changed; reload and retry' });
    if (!REQUEST_TRANSITIONS[current.status].includes(dto.status))
      throw new BadRequestException({ code: 'INVALID_REQUEST_TRANSITION', message: `Cannot move request from ${current.status} to ${dto.status}` });
    if (dto.status === RequestStatus.COMPLETED)
      throw new BadRequestException({ code: 'REPORT_REQUIRED', message: 'Requests are completed only when a report is generated' });
    if (dto.status === RequestStatus.AWAITING_VALIDATION)
      throw new BadRequestException({ code: 'RESULT_SUBMISSION_REQUIRED', message: 'Requests enter validation only when every result is submitted' });
    if (dto.status === RequestStatus.SPECIMEN_COLLECTED || dto.status === RequestStatus.IN_PROGRESS) {
      const requiredStatuses = dto.status === RequestStatus.SPECIMEN_COLLECTED
        ? [SpecimenStatus.COLLECTED, SpecimenStatus.RECEIVED, SpecimenStatus.PROCESSING, SpecimenStatus.PROCESSED]
        : [SpecimenStatus.PROCESSING, SpecimenStatus.PROCESSED];
      const ready = await this.prisma.specimen.count({ where: { requestId: id, status: { in: requiredStatuses } } });
      if (!ready) throw new BadRequestException({ code: 'SPECIMEN_STATE_REQUIRED', message: 'The required specimen workflow stage has not been reached' });
    }
    return this.prisma.$transaction(async tx => {
      const update = await tx.laboratoryRequest.updateMany({
        where: { id, version: dto.expectedVersion, status: current.status },
        data: { status: dto.status, version: { increment: 1 } },
      });
      if (update.count !== 1) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Request changed; reload and retry' });
      await this.audit.record({ actorId: user.id, action: 'REQUEST_STATUS_CHANGE', resourceType: 'LaboratoryRequest', resourceId: id, correlationId, metadata: { from: current.status, to: dto.status } }, tx);
      return tx.laboratoryRequest.findUniqueOrThrow({ where: { id } });
    });
  }
}
