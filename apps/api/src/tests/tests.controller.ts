import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/decorators';
import { CreateReferenceRangeDto, CreateTestDto, UpdateTestDto } from './tests.dto';
import { TestsService } from './tests.service';

@ApiTags('tests')
@Controller('tests')
export class TestsController {
  constructor(private tests: TestsService) {}
  private cid(req: Request) { return req.headers['x-correlation-id'] as string | undefined; }

  @Get() @RequirePermissions('tests:read')
  list(@Query('search') search?: string) { return this.tests.list(search); }

  @Get(':id') @RequirePermissions('tests:read')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.tests.get(id); }

  @Post() @RequirePermissions('tests:manage')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTestDto, @Req() req: Request) {
    return this.tests.create(dto, user.id, this.cid(req));
  }

  @Patch(':id') @RequirePermissions('tests:manage')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTestDto, @Req() req: Request) {
    return this.tests.update(id, dto, user.id, this.cid(req));
  }

  @Post(':id/reference-ranges') @RequirePermissions('tests:manage')
  createRange(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateReferenceRangeDto, @Req() req: Request) {
    return this.tests.createRange(id, dto, user.id, this.cid(req));
  }

  @Delete('reference-ranges/:rangeId') @RequirePermissions('tests:manage')
  deleteRange(@CurrentUser() user: AuthUser, @Param('rangeId', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.tests.deleteRange(id, user.id, this.cid(req));
  }
}
