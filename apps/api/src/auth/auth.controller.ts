import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService, Tokens } from './auth.service';
import { ForgotPasswordDto, LoginDto, ResetPasswordDto } from './auth.dto';
import { type AuthUser, AuthenticatedOnly, CurrentUser, Public } from '../common/decorators';

@ApiTags('auth') @Controller('auth')
export class AuthController {
  constructor(private auth: AuthService, private cfg: ConfigService) {}
  private cid = (r: Request) => r.headers['x-correlation-id'] as string | undefined;

  private setCookies(res: Response, t: Tokens) {
    const base = { httpOnly: true, secure: this.cfg.get('NODE_ENV') === 'production', sameSite: 'strict' as const };
    res.cookie('access_token', t.accessToken, { ...base, path: '/', maxAge: 15 * 60_000 });
    res.cookie('refresh_token', t.refreshToken, { ...base, path: '/api/v1/auth', expires: t.refreshExpires });
  }
  private clear(res: Response) { res.clearCookie('access_token', { path: '/' }); res.clearCookie('refresh_token', { path: '/api/v1/auth' }); }

  @Public() @Throttle({ default: { limit: 10, ttl: 60_000 } }) @HttpCode(200) @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { tokens, user } = await this.auth.login(dto.email, dto.password, this.cid(req)); this.setCookies(res, tokens); return { user };
  }
  @Public() @Throttle({ default: { limit: 30, ttl: 60_000 } }) @HttpCode(200) @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try { const { tokens, user } = await this.auth.refresh(req.cookies?.refresh_token, this.cid(req)); this.setCookies(res, tokens); return { user }; }
    catch (e) { this.clear(res); throw e; }
  }
  @Public() @HttpCode(204) @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) { await this.auth.logout(req.cookies?.refresh_token); this.clear(res); }

  @Public() @Throttle({ default: { limit: 5, ttl: 60_000 } }) @HttpCode(202) @Post('forgot-password')
  async forgot(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    await this.auth.forgotPassword(dto.email, this.cid(req)); return { message: 'If an account exists, a reset link has been sent.' };
  }
  @Public() @Throttle({ default: { limit: 5, ttl: 60_000 } }) @HttpCode(204) @Post('reset-password')
  async reset(@Body() dto: ResetPasswordDto, @Req() req: Request) { await this.auth.resetPassword(dto.token, dto.newPassword, this.cid(req)); }

  @AuthenticatedOnly() @Get('me')
  me(@CurrentUser() user: AuthUser) { return { user }; }
}
