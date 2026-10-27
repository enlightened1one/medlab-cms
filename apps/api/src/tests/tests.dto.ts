import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Gender, ResultType } from '@prisma/client';

export class CreateTestDto {
  @IsString() @MinLength(1) @MaxLength(32) code!: string;
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsString() @MinLength(1) @MaxLength(80) category!: string;
  @IsString() @MinLength(1) @MaxLength(120) specimenType!: string;
  @IsOptional() @IsString() @MaxLength(32) unit?: string;
  @IsOptional() @IsEnum(ResultType) resultType?: ResultType;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(6) decimalPlaces?: number;
}

export class UpdateTestDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) category?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) specimenType?: string;
  @IsOptional() @IsString() @MaxLength(32) unit?: string;
  @IsOptional() @IsEnum(ResultType) resultType?: ResultType;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(6) decimalPlaces?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateReferenceRangeDto {
  @IsOptional() @IsEnum(Gender) sex?: Gender;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) ageMinYears?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) ageMaxYears?: number;
  @IsOptional() @Type(() => Number) @IsNumber() lowValue?: number;
  @IsOptional() @Type(() => Number) @IsNumber() highValue?: number;
  @IsOptional() @Type(() => Number) @IsNumber() criticalLow?: number;
  @IsOptional() @Type(() => Number) @IsNumber() criticalHigh?: number;
  @IsOptional() @IsString() @MaxLength(200) textRange?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
