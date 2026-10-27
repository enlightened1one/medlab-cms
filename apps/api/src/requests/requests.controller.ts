import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/decorators';
import { CreateRequestDto, RequestsQueryDto, UpdateRequestStatusDto } from './requests.dto';
import { RequestsService } from './requests.service';

@ApiTags('requests')
@Controller('requests')
export class RequestsController {
  constructor(private requests: RequestsService) {}
  private cid(req: Request) { return req.headers['x-correlation-id'] as string | undefined; }

  @Get() @RequirePermissions('requests:read')
  list(@CurrentUser() user: AuthUser, @Query() query: RequestsQueryDto) {
    return this.requests.list(user, query.page, query.pageSize, query.status);
  }

  @Get(':id') @RequirePermissions('requests:read')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.requests.get(id, user); }

  @Post() @RequirePermissions('requests:create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRequestDto, @Req() req: Request) {
    return this.requests.create(user, dto, req.headers['idempotency-key'] as string | undefined, this.cid(req));
  }

  @Patch(':id/status') @RequirePermissions('requests:cancel')
  transition(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRequestStatusDto, @Req() req: Request) {
    return this.requests.transition(id, user, dto, this.cid(req));
  }
}
