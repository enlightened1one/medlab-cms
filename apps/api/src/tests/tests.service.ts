import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReferenceRangeDto, CreateTestDto, UpdateTestDto } from './tests.dto';

@Injectable()
export class TestsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  list(search?: string) {
    return this.prisma.laboratoryTest.findMany({
      where: { isActive: true, ...(search?.trim() ? { OR: [
        { code: { contains: search.trim(), mode: 'insensitive' } },
        { name: { contains: search.trim(), mode: 'insensitive' } },
        { category: { contains: search.trim(), mode: 'insensitive' } },
      ] } : {}) },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      include: { referenceRanges: { orderBy: [{ sex: 'asc' }, { ageMinYears: 'asc' }] } },
    });
  }

  async get(id: string) {
    const test = await this.prisma.laboratoryTest.findUnique({ where: { id }, include: { referenceRanges: true } });
    if (!test) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Test not found' });
    return test;
  }

  async create(dto: CreateTestDto, actorId: string, correlationId?: string) {
    return this.prisma.$transaction(async tx => {
      const test = await tx.laboratoryTest.create({
        data: { ...dto, code: dto.code.trim().toUpperCase(), name: dto.name.trim(), category: dto.category.trim(), specimenType: dto.specimenType.trim() },
      });
      await this.audit.record({ actorId, action: 'TEST_CREATE', resourceType: 'LaboratoryTest', resourceId: test.id, correlationId }, tx);
      return test;
    });
  }

  async update(id: string, dto: UpdateTestDto, actorId: string, correlationId?: string) {
    if (!await this.prisma.laboratoryTest.findUnique({ where: { id }, select: { id: true } }))
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Test not found' });
    return this.prisma.$transaction(async tx => {
      const test = await tx.laboratoryTest.update({ where: { id }, data: dto });
      await this.audit.record({ actorId, action: 'TEST_UPDATE', resourceType: 'LaboratoryTest', resourceId: id, correlationId }, tx);
      return test;
    });
  }

  async createRange(testId: string, dto: CreateReferenceRangeDto, actorId: string, correlationId?: string) {
    if (!await this.prisma.laboratoryTest.findUnique({ where: { id: testId }, select: { id: true } }))
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Test not found' });
    if (dto.ageMinYears !== undefined && dto.ageMaxYears !== undefined && dto.ageMinYears > dto.ageMaxYears)
      throw new BadRequestException({ code: 'INVALID_AGE_RANGE', message: 'Minimum age must not exceed maximum age' });
    const valuePairs = [[dto.lowValue, dto.highValue], [dto.criticalLow, dto.criticalHigh]];
    if (valuePairs.some(([low, high]) => low !== undefined && high !== undefined && low > high))
      throw new BadRequestException({ code: 'INVALID_REFERENCE_RANGE', message: 'A low value must not exceed its high value' });
    const hasNumeric = [dto.lowValue, dto.highValue, dto.criticalLow, dto.criticalHigh].some(value => value !== undefined);
    if (!hasNumeric && !dto.textRange?.trim())
      throw new BadRequestException({ code: 'EMPTY_REFERENCE_RANGE', message: 'Provide numeric limits or a qualitative text range' });
    const data: Prisma.ReferenceRangeUncheckedCreateInput = {
      testId, sex: dto.sex, ageMinYears: dto.ageMinYears, ageMaxYears: dto.ageMaxYears,
      lowValue: dto.lowValue, highValue: dto.highValue, criticalLow: dto.criticalLow,
      criticalHigh: dto.criticalHigh, textRange: dto.textRange?.trim(), note: dto.note?.trim(),
    };
    return this.prisma.$transaction(async tx => {
      const range = await tx.referenceRange.create({ data });
      await this.audit.record({ actorId, action: 'REFERENCE_RANGE_CREATE', resourceType: 'ReferenceRange', resourceId: range.id, correlationId }, tx);
      return range;
    });
  }

  async deleteRange(id: string, actorId: string, correlationId?: string) {
    const range = await this.prisma.referenceRange.findUnique({ where: { id }, select: { id: true } });
    if (!range) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Reference range not found' });
    return this.prisma.$transaction(async tx => {
      await tx.referenceRange.delete({ where: { id } });
      await this.audit.record({ actorId, action: 'REFERENCE_RANGE_DELETE', resourceType: 'ReferenceRange', resourceId: id, correlationId }, tx);
      return { id, deleted: true };
    });
  }
}
