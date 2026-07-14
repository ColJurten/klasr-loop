import { Module } from '@nestjs/common';
import { AnalysesRepository } from './analyses.repository';

@Module({ providers: [AnalysesRepository], exports: [AnalysesRepository] })
export class AnalysesModule {}
