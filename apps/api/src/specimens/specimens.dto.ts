import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { SpecimenStatus } from '@prisma/client';

export class TransitionSpecimenDto {
  @IsEnum(SpecimenStatus) status!: SpecimenStatus;
  @Type(() => Number) @IsInt() @Min(0) @Max(2_147_483_647) expectedVersion!: number;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsString() @MaxLength(500) rejectionReason?: string;
}
