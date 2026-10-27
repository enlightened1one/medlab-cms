import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RequestStatus, Role, SpecimenStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { TransitionSpecimenDto } from './specimens.dto';

const TRANSITIONS: Record<SpecimenStatus, readonly SpecimenStatus[]> = {
  REGISTERED: [SpecimenStatus.COLLECTED, SpecimenStatus.CANCELLED],
  COLLECTED: [SpecimenStatus.RECEIVED, SpecimenStatus.REJECTED, SpecimenStatus.CANCELLED],
  RECEIVED: [SpecimenStatus.PROCESSING, SpecimenStatus.REJECTED, SpecimenStatus.CANCELLED],
  PROCESSING: [SpecimenStatus.PROCESSED, SpecimenStatus.REJECTED, SpecimenStatus.CANCELLED],
  PROCESSED: [],
  REJECTED: [],
  CANCELLED: [],
};

@Injectable()
export class SpecimensService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  list(user: AuthUser, page = 1, pageSize = 20, status?: SpecimenStatus) {
    const take = Math.min(Math.max(pageSize || 20, 1), 100), current = Math.max(page || 1, 1), skip = (current - 1) * take;
    const where: Prisma.SpecimenWhereInput = {
      ...(status ? { status } : {}),
      ...(user.role === Role.CLINICIAN ? { request: { requestedById: user.id } } : {}),
    };
    return this.prisma.$transaction(async tx => {
      const [items, total] = await Promise.all([
        tx.specimen.findMany({
          where, orderBy: { createdAt: 'desc' }, skip, take,
          select: {
            id: true, specimenNumber: true, requestId: true, patientId: true, specimenType: true,
            status: true, collectedAt: true, receivedAt: true, rejectionReason: true, notes: true, version: true,
            patient: { select: { patientNumber: true, firstName: true, lastName: true } },
            request: { select: { requestNumber: true, requestedById: true, status: true } },
          },
        }),
        tx.specimen.count({ where }),
      ]);
      return { items, total, page: current, pageSize: take };
    });
  }

  async get(id: string, user: AuthUser) {
    const specimen = await this.prisma.specimen.findFirst({
      where: { id, ...(user.role === Role.CLINICIAN ? { request: { requestedById: user.id } } : {}) },
      include: {
        patient: { select: { patientNumber: true, firstName: true, lastName: true } },
        request: { select: { requestNumber: true, requestedById: true, status: true } },
        history: { orderBy: { createdAt: 'asc' }, include: { changedBy: { select: { fullName: true } } } },
      },
    });
    if (!specimen) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Specimen not found' });
    return specimen;
  }

  async transition(id: string, user: AuthUser, dto: TransitionSpecimenDto, correlationId?: string) {
    const current = await this.prisma.specimen.findFirst({
      where: { id, ...(user.role === Role.CLINICIAN ? { request: { requestedById: user.id } } : {}) },
      select: { status: true, version: true },
    });
    if (!current) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Specimen not found' });
    if (current.version !== dto.expectedVersion)
      throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Specimen changed; reload and retry' });
    if (!TRANSITIONS[current.status].includes(dto.status))
      throw new BadRequestException({ code: 'INVALID_SPECIMEN_TRANSITION', message: `Cannot move specimen from ${current.status} to ${dto.status}` });
    if (dto.status === SpecimenStatus.REJECTED && !dto.rejectionReason?.trim())
      throw new BadRequestException({ code: 'REJECTION_REASON_REQUIRED', message: 'A rejection reason is required' });

    return this.prisma.$transaction(async tx => {
      const now = new Date();
      const data: Prisma.SpecimenUpdateManyMutationInput = {
        status: dto.status, version: { increment: 1 }, notes: dto.note?.trim(),
        ...(dto.status === SpecimenStatus.COLLECTED ? { collectedAt: now } : {}),
        ...(dto.status === SpecimenStatus.RECEIVED ? { receivedAt: now } : {}),
        ...(dto.status === SpecimenStatus.REJECTED ? { rejectionReason: dto.rejectionReason!.trim() } : {}),
      };
      const updated = await tx.specimen.updateMany({ where: { id, status: current.status, version: dto.expectedVersion }, data });
      if (updated.count !== 1) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Specimen changed; reload and retry' });
      await tx.specimenStatusHistory.create({
        data: { specimenId: id, fromStatus: current.status, toStatus: dto.status, changedById: user.id, note: dto.status === SpecimenStatus.REJECTED ? dto.rejectionReason!.trim() : dto.note?.trim() },
      });

      if (dto.status === SpecimenStatus.COLLECTED) {
        await tx.laboratoryRequest.updateMany({
          where: { specimens: { some: { id } }, status: RequestStatus.PENDING },
          data: { status: RequestStatus.SPECIMEN_COLLECTED, version: { increment: 1 } },
        });
      } else if (dto.status === SpecimenStatus.PROCESSING) {
        await tx.laboratoryRequest.updateMany({
          where: { specimens: { some: { id } }, status: RequestStatus.SPECIMEN_COLLECTED },
          data: { status: RequestStatus.IN_PROGRESS, version: { increment: 1 } },
        });
      }

      await this.audit.record({ actorId: user.id, action: 'SPECIMEN_STATUS_CHANGE', resourceType: 'Specimen', resourceId: id, correlationId, metadata: { from: current.status, to: dto.status } }, tx);
      return tx.specimen.findUniqueOrThrow({ where: { id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
