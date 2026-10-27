import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePredictionDto, PredictionsQueryDto } from './predictions.dto';

const MODEL_CLASSES = [
  'synthetic_anemia_pattern',
  'synthetic_leukocyte_pattern',
  'synthetic_platelet_pattern',
  'synthetic_red_cell_index_pattern',
  'within_synthetic_reference',
] as const;

const predictionResponse = z.object({
  model_version: z.literal('medlab-synthetic-cbc-v1'),
  predicted_class: z.enum(MODEL_CLASSES),
  probabilities: z.record(z.number().finite().min(0).max(1)),
  synthetic_data_only: z.literal(true),
  clinical_use: z.literal(false),
}).strict().superRefine((response, context) => {
  const classes = Object.keys(response.probabilities);
  const total = Object.values(response.probabilities).reduce((sum, probability) => sum + probability, 0);
  if (
    classes.length !== MODEL_CLASSES.length
    || classes.some(name => !MODEL_CLASSES.some(modelClass => modelClass === name))
    || !classes.includes(response.predicted_class)
    || Math.abs(total - 1) > 0.001
  ) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid model probabilities or predicted class' });
  }
});

const SAFE_SELECT = {
  id: true, patientId: true, requestId: true, modelVersion: true, features: true,
  predictedClass: true, createdAt: true, requestedById: true,
} satisfies Prisma.PredictionSelect;

@Injectable()
export class PredictionsService {
  private readonly logger = new Logger(PredictionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async list(user: AuthUser, query: PredictionsQueryDto) {
    const page = Math.max(query.page || 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize || 20, 1), 100);
    const where: Prisma.PredictionWhereInput = {
      ...(user.role === Role.CLINICIAN ? { requestedById: user.id } : {}),
      ...(query.patientId ? { patientId: query.patientId } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.prediction.findMany({
        where, select: SAFE_SELECT, orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize, take: pageSize,
      }),
      this.prisma.prediction.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async create(user: AuthUser, dto: CreatePredictionDto, correlationId?: string) {
    if (user.role === Role.CLINICIAN && !dto.requestId) {
      throw new BadRequestException({ code: 'REQUEST_REQUIRED', message: 'Clinician predictions must be linked to one of their requests' });
    }
    const patient = await this.prisma.patient.findUnique({
      where: { id: dto.patientId },
      select: { id: true, archivedAt: true },
    });
    if (!patient || patient.archivedAt) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Patient not found' });

    if (dto.requestId) {
      const request = await this.prisma.laboratoryRequest.findFirst({
        where: {
          id: dto.requestId,
          patientId: dto.patientId,
          ...(user.role === Role.CLINICIAN ? { requestedById: user.id } : {}),
        },
        select: { id: true },
      });
      if (!request) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Request not found' });
    }

    const serviceUrl = this.config.getOrThrow<string>('ML_SERVICE_URL').replace(/\/+$/, '');
    const serviceToken = this.config.getOrThrow<string>('ML_SERVICE_TOKEN');
    const timeoutMs = this.config.get<number>('ML_TIMEOUT_MS', 5000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let responseStatus = 0;
    let payload: unknown;
    let invalidBody = false;
    try {
      const response = await fetch(new URL('predict', `${serviceUrl}/`), {
        method: 'POST',
        headers: { authorization: `Bearer ${serviceToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ features: dto.features }),
        signal: controller.signal,
      });
      responseStatus = response.status;
      if (response.ok) {
        const contentLength = Number(response.headers.get('content-length'));
        if (Number.isFinite(contentLength) && contentLength > 64 * 1024) {
          invalidBody = true;
        } else {
          const body = await response.text();
          if (new TextEncoder().encode(body).byteLength > 64 * 1024) {
            invalidBody = true;
          } else {
            try {
              payload = JSON.parse(body);
            } catch {
              invalidBody = true;
            }
          }
        }
      }
    } catch {
      this.logger.warn('Configured ML service request failed');
      throw new ServiceUnavailableException({ code: 'ML_SERVICE_UNAVAILABLE', message: 'Prediction service is temporarily unavailable' });
    } finally {
      clearTimeout(timeout);
    }
    if (responseStatus < 200 || responseStatus >= 300) {
      this.logger.warn(`Configured ML service returned HTTP ${responseStatus}`);
      throw new ServiceUnavailableException({ code: 'ML_SERVICE_UNAVAILABLE', message: 'Prediction service is temporarily unavailable' });
    }
    const parsed = invalidBody
      ? { success: false as const }
      : predictionResponse.safeParse(payload);
    if (!parsed.success) {
      this.logger.error('Configured ML service returned an invalid response');
      throw new ServiceUnavailableException({ code: 'ML_INVALID_RESPONSE', message: 'Prediction service returned an invalid response' });
    }
    const result = parsed.data;
    if (result.probabilities[result.predicted_class] !== Math.max(...Object.values(result.probabilities))) {
      throw new ServiceUnavailableException({ code: 'ML_INVALID_RESPONSE', message: 'Prediction service returned inconsistent probabilities' });
    }
    const featureSnapshot: Prisma.InputJsonObject = {
      age_years: dto.features.age_years,
      sex: dto.features.sex,
      hemoglobin_g_dl: dto.features.hemoglobin_g_dl,
      mcv_fl: dto.features.mcv_fl,
      wbc_10e9_l: dto.features.wbc_10e9_l,
      platelets_10e9_l: dto.features.platelets_10e9_l,
    };

    return this.prisma.$transaction(async tx => {
      const prediction = await tx.prediction.create({
        data: {
          patientId: dto.patientId,
          requestId: dto.requestId ?? null,
          requestedById: user.id,
          modelVersion: result.model_version,
          features: featureSnapshot,
          predictedClass: result.predicted_class,
        },
        select: SAFE_SELECT,
      });
      await this.audit.record({
        actorId: user.id, action: 'PREDICTION_CREATE', resourceType: 'Prediction',
        resourceId: prediction.id, correlationId,
        metadata: { modelVersion: result.model_version, predictedClass: result.predicted_class },
      }, tx);
      return { ...prediction, probabilities: result.probabilities, syntheticDataOnly: true, clinicalUse: false };
    });
  }
}
