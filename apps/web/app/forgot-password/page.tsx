'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { apiFetch } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiFetch('/auth/forgot-password', { method: 'POST', body: { email } });
      setSent(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to submit your request.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-aside"><div className="brand-lockup"><span className="brand-mark">M</span><span>MedLab<span className="brand-light"> workspace</span></span></div><div className="auth-message"><span className="eyebrow">ACCOUNT SUPPORT</span><h1>Back to what matters.</h1><p>We’ll help you securely regain access to your laboratory workspace.</p></div><div className="auth-note"><span className="status-dot" /> Secure access · Role-based workspace</div></div>
      <section className="auth-card">
        <Link className="back-link" href="/login">← Back to sign in</Link>
        <span className="eyebrow">PASSWORD RECOVERY</span>
        <h2>Reset your password</h2>
        <p className="muted">Enter the email address linked to your account. If it exists, you’ll receive reset instructions.</p>
        {sent ? <div role="status" className="notice notice-success">If an account exists, a reset link has been sent.</div> : (
          <form className="form-stack" onSubmit={submit}>
            <label>Email address<input autoComplete="email" type="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} /></label>
            {error && <div role="alert" className="notice notice-error">{error}</div>}
            <button className="button button-primary button-wide" disabled={loading}>{loading ? 'Sending…' : 'Send reset link'}<span aria-hidden="true">→</span></button>
          </form>
        )}
      </section>
    </main>
  );
}
