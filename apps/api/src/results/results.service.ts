import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RequestStatus, ResultFlag, ResultStatus, ResultType, Role, SpecimenStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { AmendResultDto, EnterResultDto } from './results.dto';

type Range = {
  id: string; sex: string | null; ageMinYears: number | null; ageMaxYears: number | null;
  lowValue: Prisma.Decimal | null; highValue: Prisma.Decimal | null;
  criticalLow: Prisma.Decimal | null; criticalHigh: Prisma.Decimal | null; textRange: string | null;
};
const SAFE = {
  id: true, requestItemId: true, specimenId: true, numericValue: true, textValue: true,
  unit: true, refLow: true, refHigh: true, refText: true, flag: true, status: true,
  comment: true, enteredAt: true, validatedAt: true, version: true,
  enteredBy: { select: { id: true, fullName: true } },
  validatedBy: { select: { id: true, fullName: true } },
  requestItem: { include: { test: { select: { code: true, name: true, unit: true } }, request: { select: { id: true, requestNumber: true, patientId: true, requestedById: true, status: true } } } },
  specimen: { select: { specimenNumber: true, status: true } },
} as const;
const FINAL_STATUSES: ResultStatus[] = [ResultStatus.VALIDATED, ResultStatus.AMENDED];

const ageAt = (birth: Date | null, on = new Date()) => {
  if (!birth) return null;
  let age = on.getUTCFullYear() - birth.getUTCFullYear();
  if (on.getUTCMonth() < birth.getUTCMonth() || (on.getUTCMonth() === birth.getUTCMonth() && on.getUTCDate() < birth.getUTCDate())) age--;
  return age;
};

const rangeFor = (ranges: Range[], gender: string, age: number | null) => ranges
  .filter(range => (range.sex === null || range.sex === gender) &&
    (range.ageMinYears === null || (age !== null && age >= range.ageMinYears)) &&
    (range.ageMaxYears === null || (age !== null && age <= range.ageMaxYears)))
  .sort((a, b) => Number(b.sex !== null) - Number(a.sex !== null) ||
    Number(b.ageMinYears !== null || b.ageMaxYears !== null) - Number(a.ageMinYears !== null || a.ageMaxYears !== null) ||
    (b.ageMinYears ?? -1) - (a.ageMinYears ?? -1))[0];

const flagFor = (numericValue: number | undefined, textValue: string | undefined, range?: Range): ResultFlag | null => {
  if (!range) return null;
  if (numericValue !== undefined) {
    if (range.criticalLow && numericValue < Number(range.criticalLow)) return ResultFlag.CRITICAL_LOW;
    if (range.criticalHigh && numericValue > Number(range.criticalHigh)) return ResultFlag.CRITICAL_HIGH;
    if (range.lowValue && numericValue < Number(range.lowValue)) return ResultFlag.LOW;
    if (range.highValue && numericValue > Number(range.highValue)) return ResultFlag.HIGH;
    return ResultFlag.NORMAL;
  }
  return textValue === range.textRange ? ResultFlag.NORMAL : ResultFlag.ABNORMAL;
};

@Injectable()
export class ResultsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async list(user: AuthUser, page = 1, pageSize = 20) {
    const take = Math.min(Math.max(pageSize || 20, 1), 100), current = Math.max(page || 1, 1), skip = (current - 1) * take;
    const where: Prisma.LaboratoryResultWhereInput = {
      ...(user.role === Role.CLINICIAN ? { status: { in: FINAL_STATUSES }, requestItem: { request: { requestedById: user.id } } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.laboratoryResult.findMany({ where, select: SAFE, orderBy: { enteredAt: 'desc' }, skip, take }),
      this.prisma.laboratoryResult.count({ where }),
    ]);
    return { items, total, page: current, pageSize: take };
  }

  async get(id: string, user: AuthUser) {
    const result = await this.prisma.laboratoryResult.findFirst({
      where: { id, ...(user.role === Role.CLINICIAN ? { status: { in: FINAL_STATUSES }, requestItem: { request: { requestedById: user.id } } } : {}) },
      select: SAFE,
    });
    if (!result) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Result not found' });
    return result;
  }

  private async context(requestItemId: string, user: AuthUser) {
    const item = await this.prisma.laboratoryRequestItem.findFirst({
      where: { id: requestItemId, ...(user.role === Role.CLINICIAN ? { request: { requestedById: user.id } } : {}) },
      include: { test: { include: { referenceRanges: true } }, request: { include: { patient: true } } },
    });
    if (!item) throw new NotFoundException({ code: 'REQUEST_ITEM_NOT_FOUND', message: 'Request item not found' });
    return item;
  }

  private validateValue(type: ResultType, numericValue?: number, textValue?: string) {
    if ((numericValue === undefined) === (textValue === undefined))
      throw new BadRequestException({ code: 'INVALID_RESULT_VALUE', message: 'Provide exactly one numeric or text result value' });
    if (type === ResultType.NUMERIC && numericValue === undefined)
      throw new BadRequestException({ code: 'NUMERIC_RESULT_REQUIRED', message: 'This test requires a numeric result' });
    if (type === ResultType.TEXT && textValue === undefined)
      throw new BadRequestException({ code: 'TEXT_RESULT_REQUIRED', message: 'This test requires a text result' });
  }

  async enter(user: AuthUser, dto: EnterResultDto, correlationId?: string) {
    const item = await this.context(dto.requestItemId, user);
    if (item.request.status === RequestStatus.CANCELLED)
      throw new BadRequestException({ code: 'REQUEST_CLOSED', message: 'Results cannot be entered for a cancelled request' });
    this.validateValue(item.test.resultType, dto.numericValue, dto.textValue);
    const existing = await this.prisma.laboratoryResult.findUnique({ where: { requestItemId: item.id } });
    if (existing && existing.status !== ResultStatus.DRAFT)
      throw new ConflictException({ code: 'RESULT_ALREADY_SUBMITTED', message: 'Only draft results can be edited; use amendment for validated results' });
    if (existing && dto.expectedVersion === undefined)
      throw new BadRequestException({ code: 'VERSION_REQUIRED', message: 'expectedVersion is required when editing a draft' });
    if (existing && existing.version !== dto.expectedVersion)
      throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Result changed; reload and retry' });

    const candidateSpecimens = await this.prisma.specimen.findMany({
      where: {
        requestId: item.requestId, specimenType: item.test.specimenType,
        status: { in: [SpecimenStatus.PROCESSING, SpecimenStatus.PROCESSED] },
        ...(dto.specimenId ? { id: dto.specimenId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    const specimen = candidateSpecimens[0];
    if (!specimen) throw new BadRequestException({ code: 'SPECIMEN_NOT_READY', message: 'A matching specimen must be processing or processed before results can be entered' });

    const range = rangeFor(item.test.referenceRanges as Range[], item.request.patient.gender, ageAt(item.request.patient.dateOfBirth));
    const data = {
      specimenId: specimen.id, numericValue: dto.numericValue, textValue: dto.textValue,
      unit: item.test.unit, refLow: range?.lowValue ?? null, refHigh: range?.highValue ?? null,
      refText: range?.textRange ?? null, flag: flagFor(dto.numericValue, dto.textValue, range),
      comment: dto.comment?.trim() || null,
    };
    return this.prisma.$transaction(async tx => {
      if (existing) {
        const updated = await tx.laboratoryResult.updateMany({
          where: { id: existing.id, status: ResultStatus.DRAFT, version: dto.expectedVersion },
          data: { ...data, version: { increment: 1 } },
        });
        if (updated.count !== 1) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Result changed; reload and retry' });
      } else {
        await tx.laboratoryResult.create({ data: { requestItemId: item.id, enteredById: user.id, ...data } });
      }
      const created = await tx.laboratoryResult.findUniqueOrThrow({ where: { requestItemId: item.id } });
      await this.audit.record({ actorId: user.id, action: existing ? 'RESULT_DRAFT_UPDATE' : 'RESULT_ENTER', resourceType: 'LaboratoryResult', resourceId: created.id, correlationId }, tx);
      return created;
    });
  }

  async submit(id: string, user: AuthUser, expectedVersion: number, correlationId?: string) {
    const row = await this.prisma.laboratoryResult.findFirst({
      where: { id, requestItem: { request: user.role === Role.CLINICIAN ? { requestedById: user.id } : {} } },
      include: { requestItem: { select: { requestId: true } } },
    });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Result not found' });
    if (row.version !== expectedVersion) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Result changed; reload and retry' });
    if (row.status !== ResultStatus.DRAFT) throw new BadRequestException({ code: 'INVALID_RESULT_TRANSITION', message: 'Only a draft result can be submitted' });
    return this.prisma.$transaction(async tx => {
      const updated = await tx.laboratoryResult.updateMany({ where: { id, version: expectedVersion, status: ResultStatus.DRAFT }, data: { status: ResultStatus.SUBMITTED, version: { increment: 1 } } });
      if (updated.count !== 1) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Result changed; reload and retry' });
      const items = await tx.laboratoryRequestItem.findMany({
        where: { requestId: row.requestItem.requestId }, include: { result: { select: { status: true } } },
      });
      const allSubmitted = items.length > 0 && items.every(item => item.result && item.result.status !== ResultStatus.DRAFT);
      if (allSubmitted) await tx.laboratoryRequest.updateMany({
        where: { id: row.requestItem.requestId, status: { in: [RequestStatus.SPECIMEN_COLLECTED, RequestStatus.IN_PROGRESS] } },
        data: { status: RequestStatus.AWAITING_VALIDATION, version: { increment: 1 } },
      });
      await this.audit.record({ actorId: user.id, action: 'RESULT_SUBMIT', resourceType: 'LaboratoryResult', resourceId: id, correlationId }, tx);
      return tx.laboratoryResult.findUniqueOrThrow({ where: { id }, select: SAFE });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async validate(id: string, user: AuthUser, expectedVersion: number, correlationId?: string) {
    const row = await this.prisma.laboratoryResult.findUnique({ where: { id }, select: { version: true, status: true } });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Result not found' });
    if (row.version !== expectedVersion) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Result changed; reload and retry' });
    if (row.status !== ResultStatus.SUBMITTED) throw new BadRequestException({ code: 'INVALID_RESULT_TRANSITION', message: 'Only a submitted result can be validated' });
    return this.prisma.$transaction(async tx => {
      const updated = await tx.laboratoryResult.updateMany({
        where: { id, version: expectedVersion, status: ResultStatus.SUBMITTED },
        data: { status: ResultStatus.VALIDATED, validatedById: user.id, validatedAt: new Date(), version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Result changed; reload and retry' });
      await this.audit.record({ actorId: user.id, action: 'RESULT_VALIDATE', resourceType: 'LaboratoryResult', resourceId: id, correlationId }, tx);
      return tx.laboratoryResult.findUniqueOrThrow({ where: { id }, select: SAFE });
    });
  }

  async amend(id: string, user: AuthUser, dto: AmendResultDto, correlationId?: string) {
    if (!dto.reason.trim()) throw new BadRequestException({ code: 'AMENDMENT_REASON_REQUIRED', message: 'An amendment reason is required' });
    const current = await this.prisma.laboratoryResult.findUnique({
      where: { id }, include: { requestItem: { include: { test: { include: { referenceRanges: true } }, request: { include: { patient: true } } } } },
    });
    if (!current) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Result not found' });
    if (current.version !== dto.expectedVersion) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Result changed; reload and retry' });
    if (!FINAL_STATUSES.includes(current.status))
      throw new BadRequestException({ code: 'INVALID_RESULT_TRANSITION', message: 'Only validated results can be amended' });
    const numericValue = dto.numericValue === undefined && dto.textValue === undefined ? (current.numericValue === null ? undefined : Number(current.numericValue)) : dto.numericValue;
    const textValue = dto.numericValue === undefined && dto.textValue === undefined ? current.textValue ?? undefined : dto.textValue;
    this.validateValue(current.requestItem.test.resultType, numericValue, textValue);
    const range = rangeFor(
      current.requestItem.test.referenceRanges as Range[], current.requestItem.request.patient.gender,
      ageAt(current.requestItem.request.patient.dateOfBirth),
    );
    return this.prisma.$transaction(async tx => {
      const previousRevision = await tx.resultRevision.aggregate({ where: { resultId: current.id }, _max: { revisionNumber: true } });
      await tx.resultRevision.create({
        data: {
          resultId: current.id, revisionNumber: (previousRevision._max.revisionNumber ?? 0) + 1, changedById: user.id, reason: dto.reason.trim(),
          snapshot: {
            numericValue: current.numericValue?.toString() ?? null, textValue: current.textValue, unit: current.unit,
            refLow: current.refLow?.toString() ?? null, refHigh: current.refHigh?.toString() ?? null, refText: current.refText,
            flag: current.flag, status: current.status, comment: current.comment, enteredById: current.enteredById,
            validatedById: current.validatedById, enteredAt: current.enteredAt.toISOString(), validatedAt: current.validatedAt?.toISOString() ?? null,
          },
        },
      });
      const updated = await tx.laboratoryResult.updateMany({
        where: { id, version: dto.expectedVersion, status: current.status },
        data: {
          numericValue, textValue, unit: current.requestItem.test.unit,
          refLow: range?.lowValue ?? null, refHigh: range?.highValue ?? null, refText: range?.textRange ?? null,
          flag: flagFor(numericValue, textValue, range), comment: dto.comment?.trim() ?? current.comment,
          status: ResultStatus.AMENDED, validatedById: user.id, validatedAt: new Date(), version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Result changed; reload and retry' });
      await this.audit.record({ actorId: user.id, action: 'RESULT_AMEND', resourceType: 'LaboratoryResult', resourceId: id, correlationId }, tx);
      return tx.laboratoryResult.findUniqueOrThrow({ where: { id }, select: SAFE });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
