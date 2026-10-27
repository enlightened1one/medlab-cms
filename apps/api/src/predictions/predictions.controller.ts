import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/decorators';
import { CreatePredictionDto, PredictionsQueryDto } from './predictions.dto';
import { PredictionsService } from './predictions.service';

@ApiTags('predictions')
@Controller('predictions')
export class PredictionsController {
  constructor(private readonly predictions: PredictionsService) {}

  @Get() @RequirePermissions('predictions:read')
  list(@CurrentUser() user: AuthUser, @Query() query: PredictionsQueryDto) {
    return this.predictions.list(user, query);
  }

  @Post() @RequirePermissions('predictions:create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePredictionDto, @Req() req: Request) {
    return this.predictions.create(user, dto, req.headers['x-correlation-id'] as string | undefined);
  }
}
