import { IsBoolean, IsEmail, IsEnum, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Role } from '@prisma/client';
const STRONG = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{12,128}$/;

// Explicit DTOs + ValidationPipe({ whitelist, forbidNonWhitelisted }) prevent mass assignment of fields like isActive/passwordHash.
export class CreateUserDto {
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @MinLength(2) @MaxLength(120) fullName!: string;
  @IsEnum(Role) role!: Role;
  @IsString() @Matches(STRONG, { message: 'Temporary password must be 12-128 characters with upper, lower case and a digit' }) temporaryPassword!: string;
}
export class UpdateRoleDto { @IsEnum(Role) role!: Role; }
export class SetActiveDto { @IsBoolean() isActive!: boolean; }
