import { IsEmail, IsOptional, IsString, MaxLength, MinLength, Matches } from 'class-validator';
const STRONG = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{12,128}$/;
export class LoginDto {
  @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @IsEmail() @MaxLength(254) username?: string;
  @IsString() @MinLength(1) @MaxLength(128) password!: string;
}
export class ForgotPasswordDto { @IsEmail() @MaxLength(254) email!: string; }
export class ResetPasswordDto {
  @IsString() @MinLength(20) @MaxLength(200) token!: string;
  @IsString() @Matches(STRONG, { message: 'Password must be 12-128 characters with upper, lower case and a digit' }) newPassword!: string;
}
