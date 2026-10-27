import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma/prisma.service';
import { Public } from './common/decorators';

@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService, private cfg: ConfigService) {}
  @Public() @Get() live() { return { status: 'ok' }; }
  /** Readiness distinguishes app, database and ML service. The ML service being down degrades but does not fail readiness. */
  @Public() @Get('ready') async ready() {
    const out = { app: 'ok', database: 'ok', mlService: 'unknown' as string };
    try { await this.prisma.$queryRaw`SELECT 1`; } catch { out.database = 'down'; }
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 2000);
      const r = await fetch(new URL('health', `${this.cfg.getOrThrow('ML_SERVICE_URL').replace(/\/+$/, '')}/`), { signal: ctl.signal }); clearTimeout(t);
      out.mlService = r.ok ? 'ok' : 'down';
    } catch { out.mlService = 'down'; }
    if (out.database !== 'ok') throw new ServiceUnavailableException({ code: 'NOT_READY', message: 'Database unavailable', details: out });
    return out;
  }
}
