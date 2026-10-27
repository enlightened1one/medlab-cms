/**
 * Deterministic, idempotent DEVELOPMENT seed. All records are fictional demonstration data (isDemo=true).
 * Refuses to run in production. Never deletes anything. Predictions are NOT seeded: they must come from a real model.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../.env') });

import { PrismaClient, Role, Gender, Priority, RequestStatus, SpecimenStatus, ResultStatus, ResultFlag, ResultType, ReportStatus, AuditOutcome } from '@prisma/client';
import { createHash } from 'crypto';
import { hashPassword } from '../src/common/password';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data when NODE_ENV=production.');
  process.exit(1);
}

const prisma = new PrismaClient();
const NOTE = 'DEMONSTRATION DATA - fictional, not a real patient or clinical record.';
const at = (daysAgo: number, hour = 9, minute = 0) => {
  const d = new Date(); d.setUTCDate(d.getUTCDate() - daysAgo); d.setUTCHours(hour, minute, 0, 0); return d;
};

// ---------- Users (credentials documented in README; demo only) ----------
const USERS = [
  { key: 'admin', email: 'admin@medlab.local', pw: 'MedLabAdmin!2026', fullName: 'Demo Administrator', role: Role.ADMINISTRATOR, active: true },
  { key: 'sci1', email: 'scientist@medlab.local', pw: 'MedLabLab!2026', fullName: 'Ngozi Eze (Demo Scientist)', role: Role.LABORATORY_SCIENTIST, active: true },
  { key: 'sci2', email: 'scientist2@medlab.local', pw: 'MedLabLab2!2026', fullName: 'Tunde Adeyemi (Demo Scientist)', role: Role.LABORATORY_SCIENTIST, active: true },
  { key: 'doc1', email: 'clinician@medlab.local', pw: 'MedLabDoctor!2026', fullName: 'Dr. Ada Obi (Demo Clinician)', role: Role.CLINICIAN, active: true },
  { key: 'doc2', email: 'clinician2@medlab.local', pw: 'MedLabDoctor2!2026', fullName: 'Dr. Yusuf Garba (Demo Clinician)', role: Role.CLINICIAN, active: true },
  { key: 'off', email: 'inactive@medlab.local', pw: 'MedLabInactive!2026', fullName: 'Deactivated Demo User', role: Role.CLINICIAN, active: false },
];

// ---------- Test catalogue (ranges are ILLUSTRATIVE; laboratories must configure their own) ----------
type RR = { sex?: Gender; low?: number; high?: number; critLow?: number; critHigh?: number; text?: string };
type TestDef = { code: string; name: string; category: string; specimen: string; unit?: string; type?: ResultType; dp: number; ranges: RR[] };
const M = Gender.MALE, F = Gender.FEMALE;
const TESTS: TestDef[] = [
  { code: 'HB', name: 'Haemoglobin', category: 'Haematology', specimen: 'Whole blood (EDTA)', unit: 'g/dL', dp: 1, ranges: [{ sex: M, low: 13, high: 17, critLow: 7, critHigh: 20 }, { sex: F, low: 12, high: 15.5, critLow: 7, critHigh: 20 }] },
  { code: 'WBC', name: 'White Blood Cell Count', category: 'Haematology', specimen: 'Whole blood (EDTA)', unit: 'x10^9/L', dp: 1, ranges: [{ low: 4, high: 11, critLow: 2, critHigh: 30 }] },
  { code: 'PLT', name: 'Platelet Count', category: 'Haematology', specimen: 'Whole blood (EDTA)', unit: 'x10^9/L', dp: 0, ranges: [{ low: 150, high: 400, critLow: 50, critHigh: 1000 }] },
  { code: 'PCV', name: 'Packed Cell Volume', category: 'Haematology', specimen: 'Whole blood (EDTA)', unit: '%', dp: 0, ranges: [{ sex: M, low: 40, high: 52 }, { sex: F, low: 36, high: 46 }] },
  { code: 'FBS', name: 'Fasting Blood Glucose', category: 'Chemistry', specimen: 'Plasma (fluoride)', unit: 'mmol/L', dp: 1, ranges: [{ low: 3.9, high: 5.6, critLow: 2.5, critHigh: 25 }] },
  { code: 'UREA', name: 'Urea', category: 'Chemistry', specimen: 'Serum', unit: 'mmol/L', dp: 1, ranges: [{ low: 2.5, high: 7.8 }] },
  { code: 'CREAT', name: 'Creatinine', category: 'Chemistry', specimen: 'Serum', unit: 'umol/L', dp: 0, ranges: [{ sex: M, low: 62, high: 106 }, { sex: F, low: 44, high: 80 }] },
  { code: 'NA', name: 'Sodium', category: 'Chemistry', specimen: 'Serum', unit: 'mmol/L', dp: 0, ranges: [{ low: 135, high: 145, critLow: 120, critHigh: 160 }] },
  { code: 'K', name: 'Potassium', category: 'Chemistry', specimen: 'Serum', unit: 'mmol/L', dp: 1, ranges: [{ low: 3.5, high: 5.1, critLow: 2.5, critHigh: 6.5 }] },
  { code: 'ALT', name: 'Alanine Aminotransferase', category: 'Liver function', specimen: 'Serum', unit: 'U/L', dp: 0, ranges: [{ low: 7, high: 56 }] },
  { code: 'AST', name: 'Aspartate Aminotransferase', category: 'Liver function', specimen: 'Serum', unit: 'U/L', dp: 0, ranges: [{ low: 10, high: 40 }] },
  { code: 'MP', name: 'Malaria Parasite', category: 'Parasitology', specimen: 'Whole blood (EDTA)', type: ResultType.TEXT, dp: 0, ranges: [{ text: 'Not seen' }] },
];
const def = (code: string) => TESTS.find(t => t.code === code)!;
const rangeFor = (code: string, sex: Gender) => {
  const rs = def(code).ranges; return rs.find(r => r.sex === sex) ?? rs.find(r => !r.sex) ?? rs[0];
};
const flagFor = (code: string, sex: Gender, num?: number, text?: string): ResultFlag => {
  const r = rangeFor(code, sex);
  if (num !== undefined) {
    if (r.critLow !== undefined && num < r.critLow) return ResultFlag.CRITICAL_LOW;
    if (r.critHigh !== undefined && num > r.critHigh) return ResultFlag.CRITICAL_HIGH;
    if (r.low !== undefined && num < r.low) return ResultFlag.LOW;
    if (r.high !== undefined && num > r.high) return ResultFlag.HIGH;
    return ResultFlag.NORMAL;
  }
  return text === r.text ? ResultFlag.NORMAL : ResultFlag.ABNORMAL;
};

// ---------- Patients (fictional) ----------
const PATIENTS = [
  { n: 1, first: 'Chinedu', last: 'Okafor', g: M, dob: '1985-03-14', phone: '+2340000000001' },
  { n: 2, first: 'Amina', last: 'Bello', g: F, dob: '1992-07-02', phone: '+2340000000002' },
  { n: 3, first: 'Tamuno', last: 'Briggs', g: F, dob: '1978-11-23', phone: '+2340000000003' },
  { n: 4, first: 'Emeka', last: 'Nwosu', g: M, dob: '2001-01-30', phone: '+2340000000004' },
  { n: 5, first: 'Blessing', last: 'Udo', g: F, dob: '1966-05-09', phone: '+2340000000005' },
  { n: 6, first: 'Ibrahim', last: 'Danjuma', g: M, dob: '1958-09-18', phone: '+2340000000006' },
];
const pNo = (n: number) => `MLP-${String(n).padStart(6, '0')}`;
const identityKey = (p: typeof PATIENTS[number]) =>
  createHash('sha256').update([p.last, p.first, p.dob, p.phone].map(s => s.trim().toLowerCase()).join('|')).digest('hex');

// ---------- Requests / specimens / results ----------
type ResSeed = { test: string; num?: number; text?: string; status: ResultStatus; validated?: boolean; amend?: { from: number; reason: string } };
type ReqSeed = {
  no: number; patient: number; by: string; priority: Priority; status: RequestStatus; days: number;
  notes: string; tests: string[]; spec: { status: SpecimenStatus; reject?: string };
  results?: ResSeed[]; report?: { status: ReportStatus; version: number };
};
const PATH = [SpecimenStatus.REGISTERED, SpecimenStatus.COLLECTED, SpecimenStatus.RECEIVED, SpecimenStatus.PROCESSING, SpecimenStatus.PROCESSED];
const pathTo = (s: SpecimenStatus): SpecimenStatus[] =>
  s === SpecimenStatus.REJECTED ? [...PATH.slice(0, 3), s] : s === SpecimenStatus.CANCELLED ? [PATH[0], s] : PATH.slice(0, PATH.indexOf(s) + 1);

const REQS: ReqSeed[] = [
  { no: 1, patient: 1, by: 'doc1', priority: Priority.ROUTINE, status: RequestStatus.COMPLETED, days: 10, notes: 'Routine review. ' + NOTE, tests: ['HB', 'WBC', 'PLT', 'PCV'], spec: { status: SpecimenStatus.PROCESSED },
    results: [{ test: 'HB', num: 14.2, status: ResultStatus.VALIDATED }, { test: 'WBC', num: 6.8, status: ResultStatus.VALIDATED },
      { test: 'PLT', num: 238, status: ResultStatus.AMENDED, amend: { from: 38, reason: 'Transcription error corrected after re-check of analyser printout' } },
      { test: 'PCV', num: 44, status: ResultStatus.VALIDATED }], report: { status: ReportStatus.AMENDED, version: 2 } },
  { no: 2, patient: 2, by: 'doc2', priority: Priority.ROUTINE, status: RequestStatus.AWAITING_VALIDATION, days: 3, notes: 'Diabetes screening. ' + NOTE, tests: ['FBS', 'UREA', 'CREAT'], spec: { status: SpecimenStatus.PROCESSED },
    results: [{ test: 'FBS', num: 6.4, status: ResultStatus.SUBMITTED }, { test: 'UREA', num: 5.1, status: ResultStatus.SUBMITTED }, { test: 'CREAT', num: 70, status: ResultStatus.SUBMITTED }] },
  { no: 3, patient: 3, by: 'doc1', priority: Priority.URGENT, status: RequestStatus.IN_PROGRESS, days: 1, notes: 'Abdominal pain. ' + NOTE, tests: ['ALT', 'AST'], spec: { status: SpecimenStatus.PROCESSING },
    results: [{ test: 'ALT', num: 48, status: ResultStatus.DRAFT }] },
  { no: 4, patient: 4, by: 'doc2', priority: Priority.URGENT, status: RequestStatus.PENDING, days: 0, notes: 'Fever for 3 days. ' + NOTE, tests: ['MP'], spec: { status: SpecimenStatus.REGISTERED } },
  { no: 5, patient: 5, by: 'doc1', priority: Priority.ROUTINE, status: RequestStatus.PENDING, days: 2, notes: 'Electrolytes. ' + NOTE, tests: ['NA', 'K'], spec: { status: SpecimenStatus.REJECTED, reject: 'Haemolysed sample - recollection required' } },
  { no: 6, patient: 6, by: 'doc2', priority: Priority.ROUTINE, status: RequestStatus.CANCELLED, days: 5, notes: 'Cancelled by requester. ' + NOTE, tests: ['HB'], spec: { status: SpecimenStatus.CANCELLED } },
  { no: 7, patient: 1, by: 'doc1', priority: Priority.STAT, status: RequestStatus.SPECIMEN_COLLECTED, days: 0, notes: 'Pre-operative check. ' + NOTE, tests: ['NA', 'K'], spec: { status: SpecimenStatus.RECEIVED } },
];

async function main() {
  const u: Record<string, string> = {};
  for (const x of USERS) {
    const passwordHash = await hashPassword(x.pw);
    const row = await prisma.user.upsert({
      where: { email: x.email },
      update: { passwordHash, role: x.role, isActive: x.active, fullName: x.fullName, isDemo: true, failedLoginCount: 0, lockedUntil: null },
      create: { email: x.email, passwordHash, role: x.role, isActive: x.active, fullName: x.fullName, isDemo: true },
    });
    u[x.key] = row.id;
  }

  const testId: Record<string, string> = {};
  for (const t of TESTS) {
    const row = await prisma.laboratoryTest.upsert({
      where: { code: t.code }, update: {},
      create: { code: t.code, name: t.name, category: t.category, specimenType: t.specimen, unit: t.unit, resultType: t.type ?? ResultType.NUMERIC, decimalPlaces: t.dp },
    });
    testId[t.code] = row.id;
    for (const [i, r] of t.ranges.entries()) {
      const id = `seed-rr-${t.code}-${i}`;
      await prisma.referenceRange.upsert({
        where: { id }, update: {},
        create: { id, testId: row.id, sex: r.sex, lowValue: r.low, highValue: r.high, criticalLow: r.critLow, criticalHigh: r.critHigh, textRange: r.text, note: 'Illustrative demo range; configure per laboratory method, age and sex.' },
      });
    }
  }

  const pid: Record<number, string> = {};
  for (const p of PATIENTS) {
    const row = await prisma.patient.upsert({
      where: { patientNumber: pNo(p.n) }, update: {},
      create: { patientNumber: pNo(p.n), identityKey: identityKey(p), firstName: p.first, lastName: p.last, gender: p.g, dateOfBirth: new Date(p.dob), phone: p.phone, isDemo: true, createdById: u.sci1, createdAt: at(30 - p.n * 3) },
    });
    pid[p.n] = row.id;
  }

  const audit: { id: string; actor: string | null; action: string; type: string; rid?: string; outcome?: AuditOutcome; when: Date; meta?: object }[] = [];
  for (const x of USERS.filter(x => x.active)) audit.push({ id: `seed-audit-login-${x.key}`, actor: u[x.key], action: 'AUTH_LOGIN', type: 'User', rid: u[x.key], when: at(1, 8) });
  audit.push({ id: 'seed-audit-login-denied', actor: null, action: 'AUTH_LOGIN', type: 'User', outcome: AuditOutcome.FAILURE, when: at(1, 7), meta: { reason: 'invalid_credentials' } });
  for (const p of PATIENTS) audit.push({ id: `seed-audit-patient-${p.n}`, actor: u.sci1, action: 'PATIENT_CREATE', type: 'Patient', rid: pid[p.n], when: at(30 - p.n * 3) });

  for (const r of REQS) {
    const reqNo = `REQ-2026-${String(r.no).padStart(4, '0')}`;
    const patient = PATIENTS.find(p => p.n === r.patient)!;
    const req = await prisma.laboratoryRequest.upsert({
      where: { requestNumber: reqNo }, update: {},
      create: { requestNumber: reqNo, patientId: pid[r.patient], requestedById: u[r.by], priority: r.priority, status: r.status, clinicalNotes: r.notes, requestDate: at(r.days, 8), isDemo: true },
    });
    audit.push({ id: `seed-audit-req-${r.no}`, actor: u[r.by], action: 'REQUEST_CREATE', type: 'LaboratoryRequest', rid: req.id, when: at(r.days, 8) });

    const items: Record<string, string> = {};
    for (const code of r.tests) {
      const it = await prisma.laboratoryRequestItem.upsert({
        where: { requestId_testId: { requestId: req.id, testId: testId[code] } }, update: {},
        create: { requestId: req.id, testId: testId[code] },
      });
      items[code] = it.id;
    }

    const spNo = `SPC-2026-${String(r.no).padStart(4, '0')}`;
    const active = r.spec.status !== SpecimenStatus.REGISTERED;
    const sp = await prisma.specimen.upsert({
      where: { specimenNumber: spNo }, update: {},
      create: {
        specimenNumber: spNo, requestId: req.id, patientId: pid[r.patient], specimenType: def(r.tests[0]).specimen, status: r.spec.status,
        collectedAt: active && r.spec.status !== SpecimenStatus.CANCELLED ? at(r.days, 8, 30) : null,
        receivedAt: new Set<SpecimenStatus>([SpecimenStatus.RECEIVED, SpecimenStatus.PROCESSING, SpecimenStatus.PROCESSED, SpecimenStatus.REJECTED]).has(r.spec.status) ? at(r.days, 9) : null,
        rejectionReason: r.spec.reject, notes: NOTE, isDemo: true,
      },
    });
    const path = pathTo(r.spec.status);
    for (const [i, s] of path.entries()) {
      const id = `seed-sh-${spNo}-${i}`;
      await prisma.specimenStatusHistory.upsert({
        where: { id }, update: {},
        create: { id, specimenId: sp.id, fromStatus: i ? path[i - 1] : null, toStatus: s, changedById: i % 2 ? u.sci1 : u.sci2, note: s === SpecimenStatus.REJECTED ? r.spec.reject : null, createdAt: at(r.days, 8, i * 10) },
      });
    }
    if (r.spec.status === SpecimenStatus.REJECTED) audit.push({ id: `seed-audit-reject-${r.no}`, actor: u.sci1, action: 'SPECIMEN_REJECT', type: 'Specimen', rid: sp.id, when: at(r.days, 9, 30) });

    for (const rs of r.results ?? []) {
      const rg = rangeFor(rs.test, patient.g); const t = def(rs.test);
      const validated = rs.status === ResultStatus.VALIDATED || rs.status === ResultStatus.AMENDED;
      const res = await prisma.laboratoryResult.upsert({
        where: { requestItemId: items[rs.test] }, update: {},
        create: {
          requestItemId: items[rs.test], specimenId: sp.id, numericValue: rs.num, textValue: rs.text, unit: t.unit,
          refLow: rg.low, refHigh: rg.high, refText: rg.text, flag: flagFor(rs.test, patient.g, rs.num, rs.text),
          status: rs.status, enteredById: u.sci2, validatedById: validated ? u.sci1 : null,
          enteredAt: at(r.days, 11), validatedAt: validated ? at(r.days, 14) : null, comment: rs.status === ResultStatus.DRAFT ? 'Awaiting repeat run' : null,
          version: rs.amend ? 1 : 0,
        },
      });
      if (rs.amend) {
        await prisma.resultRevision.upsert({
          where: { resultId_revisionNumber: { resultId: res.id, revisionNumber: 1 } }, update: {},
          create: { resultId: res.id, revisionNumber: 1, reason: rs.amend.reason, changedById: u.sci1, createdAt: at(r.days - 1 < 0 ? 0 : r.days - 1, 10),
            snapshot: { numericValue: rs.amend.from, flag: flagFor(rs.test, patient.g, rs.amend.from), status: 'VALIDATED' } },
        });
        audit.push({ id: `seed-audit-amend-${r.no}`, actor: u.sci1, action: 'RESULT_AMEND', type: 'LaboratoryResult', rid: res.id, when: at(Math.max(r.days - 1, 0), 10) });
      }
      if (validated) audit.push({ id: `seed-audit-validate-${r.no}-${rs.test}`, actor: u.sci1, action: 'RESULT_VALIDATE', type: 'LaboratoryResult', rid: res.id, when: at(r.days, 14) });
    }

    if (r.report) {
      const rep = await prisma.report.upsert({
        where: { reportNumber: `RPT-2026-${String(r.no).padStart(4, '0')}` }, update: {},
        create: { reportNumber: `RPT-2026-${String(r.no).padStart(4, '0')}`, requestId: req.id, status: r.report.status, version: r.report.version, generatedById: u.sci1, issuedAt: at(r.days, 15), isDemo: true },
      });
      audit.push({ id: `seed-audit-report-${r.no}`, actor: u.sci1, action: 'REPORT_GENERATE', type: 'Report', rid: rep.id, when: at(r.days, 15) });
    }
  }

  for (const a of audit) {
    await prisma.auditLog.upsert({
      where: { id: a.id }, update: {},
      create: { id: a.id, actorId: a.actor, action: a.action, resourceType: a.type, resourceId: a.rid, outcome: a.outcome ?? AuditOutcome.SUCCESS, correlationId: `seed-${a.id}`, metadata: a.meta ?? undefined, isDemo: true, createdAt: a.when },
    });
  }

  const counts = await Promise.all([prisma.user.count(), prisma.patient.count(), prisma.laboratoryTest.count(), prisma.laboratoryRequest.count(), prisma.specimen.count(), prisma.laboratoryResult.count(), prisma.report.count(), prisma.auditLog.count()]);
  console.log(`Seed complete. users=${counts[0]} patients=${counts[1]} tests=${counts[2]} requests=${counts[3]} specimens=${counts[4]} results=${counts[5]} reports=${counts[6]} audit=${counts[7]}`);
  console.log('Demo accounts: ' + USERS.map(x => x.email).join(', ') + ' (passwords in README; demo only)');
}

main().catch(e => { console.error('Seed failed:', e instanceof Error ? e.message : e); process.exit(1); }).finally(() => prisma.$disconnect());
