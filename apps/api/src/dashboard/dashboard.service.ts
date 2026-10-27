import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, ResultStatus, Role } from '@prisma/client';
import type { AuthUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async stats(user: AuthUser, from?: string, to?: string) {
    const start = from ? new Date(from) : undefined;
    const end = to ? new Date(to) : undefined;
    if (start && end && start > end) throw new BadRequestException({ code: 'INVALID_DATE_RANGE', message: 'from must not be after to' });
    if (end) end.setUTCHours(23, 59, 59, 999);

    const clinician = user.role === Role.CLINICIAN;
    const requestWhere: Prisma.LaboratoryRequestWhereInput = {
      ...(clinician ? { requestedById: user.id } : {}),
      ...(start || end ? { requestDate: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } } : {}),
    };
    const patientWhere: Prisma.PatientWhereInput = {};
    if (clinician) {
      patientWhere.requests = {
        some: {
          requestedById: user.id,
          ...(start || end ? { requestDate: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } } : {}),
        },
      };
    } else if (start || end) {
      patientWhere.createdAt = { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) };
    }
    const specimenWhere: Prisma.SpecimenWhereInput = {
      ...(clinician ? { request: { requestedById: user.id } } : {}),
      ...(start || end ? { createdAt: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } } : {}),
    };
    const resultWhere: Prisma.LaboratoryResultWhereInput = {
      ...(clinician ? { requestItem: { request: { requestedById: user.id } } } : {}),
      ...(start || end ? { enteredAt: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } } : {}),
    };
    const [patients, requests, specimens, results, tests] = await Promise.all([
      this.prisma.patient.count({ where: patientWhere }),
      this.prisma.laboratoryRequest.groupBy({ by: ['status'], where: requestWhere, _count: { _all: true } }),
      this.prisma.specimen.groupBy({ by: ['status'], where: specimenWhere, _count: { _all: true } }),
      this.prisma.laboratoryResult.groupBy({ by: ['status'], where: resultWhere, _count: { _all: true } }),
      this.prisma.laboratoryTest.count({ where: { isActive: true } }),
    ]);
    const counts = <T extends string>(rows: { status: T; _count: { _all: number } }[]) =>
      Object.fromEntries(rows.map(row => [row.status, row._count._all]));
    const resultCounts = counts(results);
    return {
      filters: { from: start?.toISOString() ?? null, to: end?.toISOString() ?? null },
      patients,
      tests,
      requests: counts(requests),
      specimens: counts(specimens),
      results: { ...counts(results), final: (resultCounts[ResultStatus.VALIDATED] ?? 0) + (resultCounts[ResultStatus.AMENDED] ?? 0) },
    };
  }
}
