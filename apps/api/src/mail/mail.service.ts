import { Injectable, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly log = new Logger('Mail');
  constructor(private cfg: ConfigService) {}
  /** Returns false (never throws) so password-reset responses cannot reveal delivery state. */
  async sendPasswordReset(to: string, link: string): Promise<boolean> {
    const host = this.cfg.get<string>('SMTP_HOST');
    if (!host) {
      if (this.cfg.get('NODE_ENV') === 'production') { this.log.error('SMTP not configured; reset email not sent'); return false; }
      this.log.warn(`[DEV ONLY] SMTP not configured. Password reset link for ${to}: ${link}`); return true;
    }
    try {
      const t = nodemailer.createTransport({ host, port: this.cfg.get<number>('SMTP_PORT'), auth: this.cfg.get('SMTP_USER') ? { user: this.cfg.get('SMTP_USER'), pass: this.cfg.get('SMTP_PASS') } : undefined });
      await t.sendMail({ from: this.cfg.get('EMAIL_FROM'), to, subject: 'Reset your MedLab password', text: `Use this link within 30 minutes: ${link}\nIf you did not request this, ignore this email.` });
      return true;
    } catch { this.log.error('Email delivery failed'); return false; }
  }
}
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
