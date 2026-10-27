import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/decorators';
import { PaginationDto } from '../common/pagination.dto';
import { SpecimenStatus } from '@prisma/client';
import { TransitionSpecimenDto } from './specimens.dto';
import { SpecimensService } from './specimens.service';

@ApiTags('specimens')
@Controller('specimens')
export class SpecimensController {
  constructor(private specimens: SpecimensService) {}
  private cid(req: Request) { return req.headers['x-correlation-id'] as string | undefined; }

  @Get() @RequirePermissions('specimens:read')
  list(@CurrentUser() user: AuthUser, @Query() query: PaginationDto, @Query('status') status?: SpecimenStatus) {
    return this.specimens.list(user, query.page, query.pageSize, status);
  }

  @Get(':id') @RequirePermissions('specimens:read')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.specimens.get(id, user); }

  @Patch(':id/status') @RequirePermissions('specimens:write')
  transition(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TransitionSpecimenDto, @Req() req: Request) {
    return this.specimens.transition(id, user, dto, this.cid(req));
  }
}
