import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/decorators';
import { DashboardQueryDto } from './dashboard.dto';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private dashboard: DashboardService) {}
  @Get() @RequirePermissions('stats:read')
  stats(@CurrentUser() user: AuthUser, @Query() query: DashboardQueryDto) {
    return this.dashboard.stats(user, query.from, query.to);
  }
}
