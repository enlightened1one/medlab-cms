import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Gender, Priority, RequestStatus, ResultType, Role } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { hashPassword } from '../src/common/password';
import { AllExceptionsFilter } from '../src/common/exception.filter';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Authentication and access control (database-backed)', () => {
  const origin = 'http://localhost:3000';
  const password = 'TestUser!2026Password';
  const adminEmail = `admin-${randomUUID()}@medlab.local`;
  const scientistEmail = `scientist-${randomUUID()}@medlab.local`;
  const clinicianEmail = `clinician-${randomUUID()}@medlab.local`;
  const inactiveEmail = `inactive-${randomUUID()}@medlab.local`;
  let app: INestApplication;
  let prisma: PrismaService;
  let ids: string[] = [];
  let patientIds: string[] = [];
  let requestIds: string[] = [];
  let testId = '';

  const accessCookie = (res: request.Response) => {
    const cookie = (res.headers['set-cookie']?.split(/,(?=(?:access_token|refresh_token)=)/) ?? [])
      .find(value => value.startsWith('access_token='));
    if (!cookie) throw new Error('Expected access_token cookie');
    return cookie.split(';', 1)[0];
  };
  const refreshCookie = (res: request.Response) => {
    const cookie = (res.headers['set-cookie']?.split(/,(?=(?:access_token|refresh_token)=)/) ?? [])
      .find(value => value.startsWith('refresh_token='));
    if (!cookie) throw new Error('Expected refresh_token cookie');
    return cookie.split(';', 1)[0];
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);

    const passwordHash = await hashPassword(password);
    const rows = await Promise.all([
      prisma.user.create({ data: { email: adminEmail, passwordHash, fullName: 'Test Admin', role: Role.ADMINISTRATOR } }),
      prisma.user.create({ data: { email: scientistEmail, passwordHash, fullName: 'Test Scientist', role: Role.LABORATORY_SCIENTIST } }),
      prisma.user.create({ data: { email: clinicianEmail, passwordHash, fullName: 'Test Clinician', role: Role.CLINICIAN } }),
      prisma.user.create({ data: { email: inactiveEmail, passwordHash, fullName: 'Inactive Test User', role: Role.CLINICIAN, isActive: false } }),
    ]);
    ids = rows.map(row => row.id);
    const patients = await Promise.all([
      prisma.patient.create({ data: { patientNumber: `MLP-IT-${randomUUID()}`, firstName: 'Owner', lastName: 'Patient', gender: Gender.UNKNOWN, createdById: ids[0] } }),
      prisma.patient.create({ data: { patientNumber: `MLP-IT-${randomUUID()}`, firstName: 'Other', lastName: 'Patient', gender: Gender.UNKNOWN, createdById: ids[0] } }),
    ]);
    patientIds = patients.map(patient => patient.id);
    const requests = await Promise.all([
      prisma.laboratoryRequest.create({ data: { requestNumber: `REQ-IT-${randomUUID()}`, patientId: patientIds[0], requestedById: ids[2], priority: Priority.ROUTINE, status: RequestStatus.PENDING } }),
      prisma.laboratoryRequest.create({ data: { requestNumber: `REQ-IT-${randomUUID()}`, patientId: patientIds[1], requestedById: ids[1], priority: Priority.ROUTINE, status: RequestStatus.PENDING } }),
    ]);
    requestIds = requests.map(row => row.id);
    const test = await prisma.laboratoryTest.create({
      data: { code: `T${randomUUID().replace(/-/g, '').slice(0, 20)}`, name: 'Integration Test', category: 'Test', specimenType: 'Test tube', resultType: ResultType.NUMERIC },
    });
    testId = test.id;
  });

  afterAll(async () => {
    if (requestIds?.length) {
      const specimens = await prisma.specimen.findMany({ where: { requestId: { in: requestIds } }, select: { id: true } });
      await prisma.auditLog.deleteMany({ where: { resourceId: { in: [...requestIds, ...patientIds, ...ids] } } });
      await prisma.specimenStatusHistory.deleteMany({ where: { specimenId: { in: specimens.map(specimen => specimen.id) } } });
      await prisma.laboratoryResult.deleteMany({ where: { requestItem: { requestId: { in: requestIds } } } });
      await prisma.laboratoryRequestItem.deleteMany({ where: { requestId: { in: requestIds } } });
      await prisma.specimen.deleteMany({ where: { requestId: { in: requestIds } } });
      await prisma.report.deleteMany({ where: { requestId: { in: requestIds } } });
      await prisma.laboratoryRequest.deleteMany({ where: { id: { in: requestIds } } });
    }
    if (patientIds?.length) await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    if (testId) {
      await prisma.referenceRange.deleteMany({ where: { testId } });
      await prisma.laboratoryTest.deleteMany({ where: { id: testId } });
    }
    if (ids?.length) {
      await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { resourceId: { in: ids } }] } });
      await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
      await prisma.passwordResetToken.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    await app?.close();
  });

  it('authenticates active users, rejects inactive users, and serves /auth/me', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login').set('Origin', origin).send({ email: adminEmail, password });
    expect(login.status).toBe(200);
    expect(login.body.user.email).toBe(adminEmail);
    expect(JSON.stringify(login.body)).not.toContain('accessToken');
    const currentUser = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', accessCookie(login)).expect(200);
    expect(currentUser.body.user).toMatchObject({ email: adminEmail, fullName: 'Test Admin', role: 'ADMINISTRATOR' });

    await request(app.getHttpServer())
      .post('/api/v1/auth/login').set('Origin', origin).send({ email: inactiveEmail, password }).expect(401);
  });

  it('denies unauthenticated and wrong-role user administration', async () => {
    await request(app.getHttpServer()).get('/api/v1/users').expect(401);
    const scientist = await request(app.getHttpServer())
      .post('/api/v1/auth/login').set('Origin', origin).send({ email: scientistEmail, password }).expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/users').set('Cookie', accessCookie(scientist)).expect(403);
    const admin = await request(app.getHttpServer())
      .post('/api/v1/auth/login').set('Origin', origin).send({ email: adminEmail, password }).expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/users').set('Cookie', accessCookie(admin)).expect(200);
  });

  it('keeps clinician request history scoped to requests they created', async () => {
    const clinician = await request(app.getHttpServer())
      .post('/api/v1/auth/login').set('Origin', origin).send({ email: clinicianEmail, password }).expect(200);
    await request(app.getHttpServer()).get('/api/v1/patients').set('Cookie', accessCookie(clinician)).expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/requests/${requestIds[0]}`).set('Cookie', accessCookie(clinician)).expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/requests/${requestIds[1]}`).set('Cookie', accessCookie(clinician)).expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientIds[1]}/history`).set('Cookie', accessCookie(clinician)).expect(404);
  });

  it('creates clinician-owned requests and rejects requests without an idempotency key', async () => {
    const clinician = await request(app.getHttpServer())
      .post('/api/v1/auth/login').set('Origin', origin).send({ email: clinicianEmail, password }).expect(200);
    const created = await request(app.getHttpServer())
      .post('/api/v1/requests').set('Origin', origin).set('Cookie', accessCookie(clinician))
      .set('Idempotency-Key', randomUUID())
      .send({ patientId: patientIds[1], testIds: [testId] }).expect(201);
    requestIds.push(created.body.id as string);
    expect(created.body.items).toHaveLength(1);
    expect(created.body.specimens).toHaveLength(1);
    await request(app.getHttpServer())
      .post('/api/v1/requests').set('Origin', origin).set('Cookie', accessCookie(clinician))
      .send({ patientId: patientIds[1], testIds: [testId] }).expect(400);
  });

  it('rejects unsafe requests without an allowed Origin', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login').send({ email: adminEmail, password }).expect(403);
  });

  it('rotates refresh tokens and revokes their family on reuse', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login').set('Origin', origin).send({ email: adminEmail, password }).expect(200);
    const original = refreshCookie(login);
    const rotated = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh').set('Origin', origin).set('Cookie', original).expect(200);
    const replacement = refreshCookie(rotated);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh').set('Origin', origin).set('Cookie', original).expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh').set('Origin', origin).set('Cookie', replacement).expect(401);
  });

  it('logs out and invalidates the refresh token', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login').set('Origin', origin).send({ email: adminEmail, password }).expect(200);
    const refresh = refreshCookie(login);
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout').set('Origin', origin).set('Cookie', refresh).expect(204);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh').set('Origin', origin).set('Cookie', refresh).expect(401);
  });

  it('returns an enumeration-safe forgot response and accepts a one-time reset token', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password').set('Origin', origin)
      .send({ email: `unknown-${randomUUID()}@medlab.local` }).expect(202);

    const token = randomBytes(32).toString('base64url');
    await prisma.passwordResetToken.create({
      data: {
        userId: ids[0],
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + 5 * 60_000),
      },
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password').set('Origin', origin)
      .send({ token, newPassword: 'ResetTest!2026Password' }).expect(204);
    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password').set('Origin', origin)
      .send({ token, newPassword: 'AnotherTest!2026Password' }).expect(401);
  });
});
