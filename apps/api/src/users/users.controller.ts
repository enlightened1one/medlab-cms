import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { type AuthUser, CurrentUser, RequirePermissions } from '../common/decorators';
import { UsersService } from './users.service';
import { CreateUserDto, SetActiveDto, UpdateRoleDto } from './users.dto';

@ApiTags('users') @Controller('users') @RequirePermissions('users:manage')
export class UsersController {
  constructor(private users: UsersService) {}
  private cid = (r: Request) => r.headers['x-correlation-id'] as string | undefined;
  @Get() list(@Query('page') page?: string, @Query('pageSize') pageSize?: string) { return this.users.list(Number(page) || 1, Number(pageSize) || 20); }
  @Post() create(@CurrentUser() me: AuthUser, @Body() dto: CreateUserDto, @Req() r: Request) { return this.users.create(me.id, dto, this.cid(r)); }
  @Patch(':id/active') setActive(@CurrentUser() me: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: SetActiveDto, @Req() r: Request) { return this.users.setActive(me.id, id, b.isActive, this.cid(r)); }
  @Patch(':id/role') setRole(@CurrentUser() me: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: UpdateRoleDto, @Req() r: Request) { return this.users.setRole(me.id, id, b.role, this.cid(r)); }
}
