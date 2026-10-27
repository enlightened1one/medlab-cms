import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsUUID, Max, Min, ValidateNested } from 'class-validator';

export class CbcFeaturesDto {
  @Type(() => Number) @IsInt() @Min(0) @Max(120) age_years!: number;
  @IsIn(['MALE', 'FEMALE', 'OTHER', 'UNKNOWN']) sex!: 'MALE' | 'FEMALE' | 'OTHER' | 'UNKNOWN';
  @Type(() => Number) @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) @Max(30) hemoglobin_g_dl!: number;
  @Type(() => Number) @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) @Max(200) mcv_fl!: number;
  @Type(() => Number) @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) @Max(500) wbc_10e9_l!: number;
  @Type(() => Number) @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) @Max(5000) platelets_10e9_l!: number;
}

export class CreatePredictionDto {
  @IsUUID() patientId!: string;
  @IsOptional() @IsUUID() requestId?: string;
  @ValidateNested() @Type(() => CbcFeaturesDto) features!: CbcFeaturesDto;
}

export class PredictionsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(2_147_483_647) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @IsOptional() @IsUUID() patientId?: string;
}
