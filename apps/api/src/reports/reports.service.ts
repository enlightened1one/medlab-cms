import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReportStatus, RequestStatus, ResultStatus, Role } from '@prisma/client';
import * as pdfMake from 'pdfmake';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import { resolve, dirname } from 'path';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

const PAGE = (page?: number, pageSize?: number) => {
  const size = Math.min(Math.max(Number.isInteger(pageSize) ? pageSize! : 20, 1), 100);
  const current = Math.max(Number.isInteger(page) ? page! : 1, 1);
  return { page: current, pageSize: size, skip: (current - 1) * size };
};
const FINAL_STATUSES: ResultStatus[] = [ResultStatus.VALIDATED, ResultStatus.AMENDED];

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async list(user: AuthUser, page = 1, pageSize = 20) {
    const { page: current, pageSize: size, skip } = PAGE(page, pageSize);
    const where: Prisma.ReportWhereInput = user.role === Role.CLINICIAN ? { request: { requestedById: user.id } } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.report.findMany({
        where, orderBy: { issuedAt: 'desc' }, skip, take: size,
        select: {
          id: true, reportNumber: true, status: true, issuedAt: true, version: true,
          request: { select: { id: true, requestNumber: true, patient: { select: { patientNumber: true, firstName: true, lastName: true } } } },
        },
      }),
      this.prisma.report.count({ where }),
    ]);
    return { items, total, page: current, pageSize: size };
  }

  async get(id: string, user: AuthUser) {
    const report = await this.prisma.report.findFirst({
      where: { id, ...(user.role === Role.CLINICIAN ? { request: { requestedById: user.id } } : {}) },
      include: { request: { include: {
        patient: { select: { patientNumber: true, firstName: true, lastName: true, gender: true, dateOfBirth: true } },
        requestedBy: { select: { fullName: true } },
        items: { include: {
          test: { select: { code: true, name: true, unit: true, resultType: true } },
          result: { where: { status: { in: FINAL_STATUSES } }, select: {
            numericValue: true, textValue: true, unit: true, flag: true, refLow: true, refHigh: true, refText: true,
            status: true, comment: true, validatedAt: true,
          } },
        } },
        specimens: { select: { specimenNumber: true, specimenType: true, collectedAt: true, receivedAt: true } },
      } } },
    });
    if (!report) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Report not found' });
    return report;
  }

  async generate(requestId: string, user: AuthUser, expectedVersion?: number, correlationId?: string) {
    const request = await this.prisma.laboratoryRequest.findUnique({
      where: { id: requestId },
      include: { items: { include: { result: true } }, report: true },
    });
    if (!request) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Request not found' });
    if (!request.items.length || request.items.some(item => !item.result || !FINAL_STATUSES.includes(item.result.status)))
      throw new BadRequestException({ code: 'RESULTS_NOT_VALIDATED', message: 'A final report requires a validated result for every request item' });
    if (request.status !== RequestStatus.AWAITING_VALIDATION && request.status !== RequestStatus.COMPLETED)
      throw new BadRequestException({ code: 'REQUEST_NOT_READY', message: 'Request must be awaiting validation before report generation' });

    return this.prisma.$transaction(async tx => {
      if (request.report) {
        if (expectedVersion === undefined)
          throw new BadRequestException({ code: 'VERSION_REQUIRED', message: 'expectedVersion is required to amend an existing report' });
        if (request.report.version !== expectedVersion)
          throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Report changed; reload and retry' });
        if (!request.items.some(item => item.result?.status === ResultStatus.AMENDED && item.result.updatedAt > request.report!.issuedAt))
          throw new BadRequestException({ code: 'NO_REPORT_CHANGES', message: 'No amended results are available for this report' });
        const updated = await tx.report.updateMany({
          where: { id: request.report.id, version: expectedVersion },
          data: { status: ReportStatus.AMENDED, version: { increment: 1 }, issuedAt: new Date(), generatedById: user.id },
        });
        if (updated.count !== 1) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Report changed; reload and retry' });
        await this.audit.record({ actorId: user.id, action: 'REPORT_AMEND', resourceType: 'Report', resourceId: request.report.id, correlationId }, tx);
        return tx.report.findUniqueOrThrow({ where: { id: request.report.id } });
      }

      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`medlab:report:${new Date().getUTCFullYear()}`})::bigint)`;
      const year = new Date().getUTCFullYear();
      const existingNumbers = await tx.report.findMany({ where: { reportNumber: { startsWith: `RPT-${year}-` } }, select: { reportNumber: true } });
      const next = existingNumbers.reduce((max, row) => Math.max(max, Number(row.reportNumber.split('-').at(-1)) || 0), 0) + 1;
      const report = await tx.report.create({
        data: { reportNumber: `RPT-${year}-${String(next).padStart(4, '0')}`, requestId, generatedById: user.id },
      });
      if (request.status !== RequestStatus.COMPLETED) {
        const updated = await tx.laboratoryRequest.updateMany({
          where: { id: requestId, status: RequestStatus.AWAITING_VALIDATION, version: request.version },
          data: { status: RequestStatus.COMPLETED, version: { increment: 1 } },
        });
        if (updated.count !== 1) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Request changed; reload and retry' });
      }
      await this.audit.record({ actorId: user.id, action: 'REPORT_GENERATE', resourceType: 'Report', resourceId: report.id, correlationId }, tx);
      return report;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async pdf(id: string, user: AuthUser) {
    const report = await this.get(id, user);
    const packageRoot = dirname(require.resolve('pdfmake'));
    const regularFont = resolve(packageRoot, '../fonts/Roboto/Roboto-Regular.ttf');
    const mediumFont = resolve(packageRoot, '../fonts/Roboto/Roboto-Medium.ttf');
    const allowedFonts = new Set([regularFont, mediumFont]);
    pdfMake.setUrlAccessPolicy(() => false);
    pdfMake.setLocalAccessPolicy(filePath => allowedFonts.has(resolve(filePath)));
    pdfMake.addFonts({
      Roboto: {
        normal: regularFont,
        bold: mediumFont,
        italics: regularFont,
        bolditalics: mediumFont,
      },
    });
    const content: Content[] = [
      { text: 'MedLab Laboratory Report', style: 'header' },
      { text: `Report: ${report.reportNumber}    Status: ${report.status}    Version: ${report.version}` },
      { text: `Patient: ${report.request.patient.firstName} ${report.request.patient.lastName} (${report.request.patient.patientNumber})` },
      { text: `Request: ${report.request.requestNumber}    Issued: ${report.issuedAt.toISOString()}` },
      { text: `Requested by: ${report.request.requestedBy.fullName}`, margin: [0, 0, 0, 12] },
      {
        table: {
          headerRows: 1,
          widths: ['auto', '*', 'auto', 'auto', '*'],
          body: [
            ['Code', 'Test', 'Result', 'Flag', 'Reference'],
            ...report.request.items.map(item => {
              const result = item.result;
              return [
                item.test.code,
                item.test.name,
                result ? result.numericValue?.toString() ?? result.textValue ?? '' : '',
                result?.flag ?? '',
                result?.refText ?? [result?.refLow?.toString(), result?.refHigh?.toString()].filter(Boolean).join(' - '),
              ];
            }),
          ],
        },
        layout: 'lightHorizontalLines',
      },
      { text: 'Laboratory reference ranges must be configured and interpreted by qualified professionals.', style: 'note', margin: [0, 18, 0, 0] },
      { text: 'Confidential clinical information. Verify patient identity before use.', style: 'note' },
    ];
    const definition: TDocumentDefinitions = {
      pageSize: 'A4', pageMargins: [40, 48, 40, 48], defaultStyle: { font: 'Roboto', fontSize: 9 },
      content,
      styles: { header: { fontSize: 18, bold: true, margin: [0, 0, 0, 14] }, note: { fontSize: 8, color: '#555555' } },
      footer: (page, pages) => ({ text: `${page} / ${pages}`, alignment: 'right', margin: [0, 15, 40, 0], fontSize: 8 }),
    };
    const buffer = await pdfMake.createPdf(definition).getBuffer();
    return { reportNumber: report.reportNumber, buffer };
  }

  async printHtml(id: string, user: AuthUser) {
    const report = await this.get(id, user);
    const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
    const rows = report.request.items.map(item => {
      const result = item.result;
      return `<tr><td>${escape(item.test.code)}</td><td>${escape(item.test.name)}</td><td>${escape(result?.numericValue?.toString() ?? result?.textValue ?? '')}</td><td>${escape(result?.flag ?? '')}</td><td>${escape(result?.refText ?? [result?.refLow?.toString(), result?.refHigh?.toString()].filter(Boolean).join(' - '))}</td></tr>`;
    }).join('');
    return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escape(report.reportNumber)}</title><style>body{font:14px Arial,sans-serif;margin:2rem;color:#172b35}h1{color:#087e8b}table{border-collapse:collapse;width:100%;margin-top:1.5rem}th,td{border-bottom:1px solid #ccd7dc;padding:.6rem;text-align:left}@media print{button{display:none}}</style><h1>MedLab Laboratory Report</h1><p>Report ${escape(report.reportNumber)} · ${escape(report.status)} · Version ${report.version}</p><p>Patient: ${escape(report.request.patient.firstName)} ${escape(report.request.patient.lastName)} (${escape(report.request.patient.patientNumber)})</p><p>Request: ${escape(report.request.requestNumber)} · Issued ${escape(report.issuedAt.toISOString())}</p><table><thead><tr><th>Code</th><th>Test</th><th>Result</th><th>Flag</th><th>Reference</th></tr></thead><tbody>${rows}</tbody></table><p>Reference ranges are laboratory-configured. Confidential clinical information.</p><button onclick="window.print()">Print</button></html>`;
  }
}
