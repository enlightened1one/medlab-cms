import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../common/decorators';
import { AuditLogsQueryDto } from './audit-logs.dto';
import { AuditLogsService } from './audit-logs.service';

@ApiTags('audit logs')
@Controller('audit-logs')
@RequirePermissions('audit:read')
export class AuditLogsController {
  constructor(private logs: AuditLogsService) {}
  @Get() list(@Query() query: AuditLogsQueryDto) { return this.logs.list(query); }
}
