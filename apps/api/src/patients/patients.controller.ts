import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { type AuthUser, CurrentUser, RequirePermissions } from '../common/decorators';
import { PaginationDto } from '../common/pagination.dto';
import { CreatePatientDto, SearchPatientsDto, UpdatePatientDto } from './patients.dto';
import { PatientsService } from './patients.service';

@ApiTags('patients')
@Controller('patients')
export class PatientsController {
  constructor(private patients: PatientsService) {}
  private cid(req: Request) { return req.headers['x-correlation-id'] as string | undefined; }

  @Get() @RequirePermissions('patients:read')
  list(@CurrentUser() user: AuthUser, @Query() query: SearchPatientsDto) { return this.patients.list(user, query); }

  @Get(':id/history') @RequirePermissions('patients:read')
  history(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() query: PaginationDto) {
    return this.patients.history(id, user, query.page, query.pageSize);
  }

  @Get(':id') @RequirePermissions('patients:read')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.patients.get(id, user); }

  @Post() @RequirePermissions('patients:write')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePatientDto, @Req() req: Request) {
    return this.patients.create(user, dto, this.cid(req));
  }

  @Patch(':id') @RequirePermissions('patients:write')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePatientDto, @Req() req: Request) {
    return this.patients.update(id, user, dto, this.cid(req));
  }

  @Post(':id/archive') @RequirePermissions('patients:write')
  archive(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.patients.archive(id, user, this.cid(req));
  }
}
