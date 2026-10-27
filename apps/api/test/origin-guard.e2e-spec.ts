import { ConfigService } from '@nestjs/config';
import { allowedRequestOrigins } from '../src/common/guards';

describe('Vercel request origins', () => {
  it('allows the configured origin and this Vercel preview deployment', () => {
    const origins = allowedRequestOrigins(new ConfigService({
      CORS_ORIGINS: 'https://medlab.example',
      VERCEL_ENV: 'preview',
      VERCEL_URL: 'medlab-git-feature.vercel.app',
    }));

    expect(origins).toEqual(['https://medlab.example', 'https://medlab-git-feature.vercel.app']);
  });

  it('does not trust preview hosts outside vercel.app', () => {
    const origins = allowedRequestOrigins(new ConfigService({
      CORS_ORIGINS: 'https://medlab.example',
      VERCEL_ENV: 'preview',
      VERCEL_URL: 'attacker.example',
    }));

    expect(origins).toEqual(['https://medlab.example']);
  });

  it('does not add deployment hosts outside preview environments', () => {
    const origins = allowedRequestOrigins(new ConfigService({
      CORS_ORIGINS: 'https://medlab.example',
      VERCEL_ENV: 'production',
      VERCEL_URL: 'medlab-git-feature.vercel.app',
    }));

    expect(origins).toEqual(['https://medlab.example']);
  });
});
