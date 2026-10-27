import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { json } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/exception.filter';
import { allowedRequestOrigins } from './common/guards';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const cfg = app.get(ConfigService);
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.use(cookieParser());
  app.use(json({ limit: '100kb' }));
  app.enableCors({ origin: allowedRequestOrigins(cfg), credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
  if (cfg.get('NODE_ENV') !== 'production') {
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('MedLab API').setVersion('0.1').addCookieAuth('access_token').build()));
  }
  await app.listen(cfg.get<number>('PORT')!);
}
bootstrap().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
