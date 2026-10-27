import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { resolve } from 'path';
import { validateEnv } from './config/env';
import { PrismaModule } from './prisma/prisma.service';
import { AuditModule } from './audit/audit.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PatientsModule } from './patients/patients.module';
import { TestsModule } from './tests/tests.module';
import { RequestsModule } from './requests/requests.module';
import { SpecimensModule } from './specimens/specimens.module';
import { ResultsModule } from './results/results.module';
import { ReportsModule } from './reports/reports.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { PredictionsModule } from './predictions/predictions.module';
import { HealthController } from './health.controller';
import { JwtAuthGuard, OriginGuard, PermissionsGuard } from './common/guards';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: resolve(process.cwd(), '../../.env'), validate: validateEnv }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule, AuditModule, AuthModule, UsersModule, PatientsModule, TestsModule,
    RequestsModule, SpecimensModule, ResultsModule, ReportsModule, DashboardModule, AuditLogsModule, PredictionsModule,
  ],
  controllers: [HealthController],
  providers: [ // order matters: throttle -> origin(CSRF) -> authenticate -> authorize (deny by default)
    { provide: APP_GUARD, useClass: ThrottlerGuard }, { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
