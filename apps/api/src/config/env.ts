import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(7),
  FRONTEND_URL: z.string().url(),
  CORS_ORIGINS: z.string().min(1),
  ML_SERVICE_URL: z.string().url(),
  ML_SERVICE_TOKEN: z.string().min(32, 'must be at least 32 characters'),
  ML_TIMEOUT_MS: z.coerce.number().default(5000),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().default('no-reply@example.invalid'),
});
export type Env = z.infer<typeof schema>;

/** Fails fast at startup. Reports variable NAMES and rules only, never values. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const r = schema.safeParse(raw);
  if (!r.success) {
    const msg = r.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration -> ${msg}`);
  }
  if (r.data.NODE_ENV === 'production' && /REPLACE_WITH|CHANGE_ME/.test(`${raw.JWT_ACCESS_SECRET}${raw.ML_SERVICE_TOKEN}`))
    throw new Error('Invalid environment configuration -> placeholder secrets are not allowed in production');
  return r.data;
}
