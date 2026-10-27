import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class GenerateReportDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(2_147_483_647) expectedVersion?: number;
}
