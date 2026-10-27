import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/decorators';
import { PaginationDto } from '../common/pagination.dto';
import { GenerateReportDto } from './reports.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private reports: ReportsService) {}
  private cid(req: Request) { return req.headers['x-correlation-id'] as string | undefined; }

  @Get() @RequirePermissions('reports:read')
  list(@CurrentUser() user: AuthUser, @Query() query: PaginationDto) { return this.reports.list(user, query.page, query.pageSize); }

  @Get(':id/print') @RequirePermissions('reports:read') @Header('Content-Type', 'text/html; charset=utf-8')
  print(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.reports.printHtml(id, user); }

  @Get(':id/pdf') @RequirePermissions('reports:read')
  async pdf(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const result = await this.reports.pdf(id, user);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${result.reportNumber}.pdf"` });
    res.send(result.buffer);
  }

  @Get(':id') @RequirePermissions('reports:read')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.reports.get(id, user); }

  @Post('/request/:requestId/generate') @RequirePermissions('reports:generate')
  generate(@CurrentUser() user: AuthUser, @Param('requestId', ParseUUIDPipe) requestId: string, @Body() dto: GenerateReportDto, @Req() req: Request) {
    return this.reports.generate(requestId, user, dto.expectedVersion, this.cid(req));
  }
}
