import { Module } from '@nestjs/common';
import { SpecimensController } from './specimens.controller';
import { SpecimensService } from './specimens.service';

@Module({ controllers: [SpecimensController], providers: [SpecimensService] })
export class SpecimensModule {}
