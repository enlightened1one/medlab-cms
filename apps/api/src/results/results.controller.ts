import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { type AuthUser, CurrentUser, RequirePermissions } from '../common/decorators';
import { PaginationDto } from '../common/pagination.dto';
import { AmendResultDto, EnterResultDto, ResultVersionDto } from './results.dto';
import { ResultsService } from './results.service';

@ApiTags('results')
@Controller('results')
export class ResultsController {
  constructor(private results: ResultsService) {}
  private cid(req: Request) { return req.headers['x-correlation-id'] as string | undefined; }

  @Get() @RequirePermissions('results:read')
  list(@CurrentUser() user: AuthUser, @Query() query: PaginationDto) { return this.results.list(user, query.page, query.pageSize); }

  @Get(':id') @RequirePermissions('results:read')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.results.get(id, user); }

  @Post() @RequirePermissions('results:enter')
  enter(@CurrentUser() user: AuthUser, @Body() dto: EnterResultDto, @Req() req: Request) { return this.results.enter(user, dto, this.cid(req)); }

  @Post(':id/submit') @RequirePermissions('results:enter')
  submit(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResultVersionDto, @Req() req: Request) {
    return this.results.submit(id, user, dto.expectedVersion, this.cid(req));
  }

  @Post(':id/validate') @RequirePermissions('results:validate')
  validate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResultVersionDto, @Req() req: Request) {
    return this.results.validate(id, user, dto.expectedVersion, this.cid(req));
  }

  @Patch(':id/amend') @RequirePermissions('results:amend')
  amend(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AmendResultDto, @Req() req: Request) {
    return this.results.amend(id, user, dto, this.cid(req));
  }
}
