import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class EnterResultDto {
  @IsUUID() requestItemId!: string;
  @IsOptional() @IsUUID() specimenId?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ allowNaN: false, allowInfinity: false }) numericValue?: number;
  @IsOptional() @IsString() @MaxLength(2000) textValue?: string;
  @IsOptional() @IsString() @MaxLength(1000) comment?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(2_147_483_647) expectedVersion?: number;
}

export class ResultVersionDto {
  @Type(() => Number) @IsInt() @Min(0) @Max(2_147_483_647) expectedVersion!: number;
}

export class AmendResultDto extends ResultVersionDto {
  @IsString() @MaxLength(1000) reason!: string;
  @IsOptional() @Type(() => Number) @IsNumber({ allowNaN: false, allowInfinity: false }) numericValue?: number;
  @IsOptional() @IsString() @MaxLength(2000) textValue?: string;
  @IsOptional() @IsString() @MaxLength(1000) comment?: string;
}
