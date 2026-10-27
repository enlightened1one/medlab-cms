import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
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
  const inactiveEmail = `inactive-${randomUUID()}@medlab.local`;
  let app: INestApplication;
  let prisma: PrismaService;
  let ids: string[] = [];

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
      prisma.user.create({ data: { email: inactiveEmail, passwordHash, fullName: 'Inactive Test User', role: Role.CLINICIAN, isActive: false } }),
    ]);
    ids = rows.map(row => row.id);
  });

  afterAll(async () => {
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
    await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', accessCookie(login)).expect(200);

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
