import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Priority, RequestStatus } from '@prisma/client';

export class CreateRequestDto {
  @IsUUID() patientId!: string;
  @IsArray() @ArrayMinSize(1) @IsUUID('4', { each: true }) testIds!: string[];
  @IsOptional() @IsEnum(Priority) priority?: Priority;
  @IsOptional() @IsString() @MaxLength(2000) clinicalNotes?: string;
}

export class UpdateRequestStatusDto {
  @IsEnum(RequestStatus) status!: RequestStatus;
  @Type(() => Number) @IsInt() @Min(0) @Max(2_147_483_647) expectedVersion!: number;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class RequestsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @IsOptional() @IsEnum(RequestStatus) status?: RequestStatus;
}
