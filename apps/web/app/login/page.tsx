'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { User } from '@/lib/types';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiFetch<{ user: User }>('/auth/login', { method: 'POST', body: { username: email, password } });
      window.location.assign('/dashboard');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to sign in. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-aside">
        <div className="brand-lockup"><span className="brand-mark">M</span><span>MedLab<span className="brand-light"> workspace</span></span></div>
        <div className="auth-message">
          <span className="eyebrow">LABORATORY OPERATIONS</span>
          <h1>Clarity at every step of care.</h1>
          <p>One secure workspace for laboratory teams and the clinicians who depend on them.</p>
        </div>
        <div className="auth-note"><span className="status-dot" /> Secure access · Role-based workspace</div>
      </div>
      <section className="auth-card">
        <span className="eyebrow">WELCOME BACK</span>
        <h2>Sign in to MedLab</h2>
        <p className="muted">Use your work account to continue.</p>
        <form className="form-stack" onSubmit={submit}>
          <label>Email address<input autoComplete="username" type="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="name@laboratory.org" /></label>
          <label>Password<input autoComplete="current-password" type="password" required maxLength={128} value={password} onChange={event => setPassword(event.target.value)} placeholder="Enter your password" /></label>
          {error && <div role="alert" className="notice notice-error">{error}</div>}
          <button className="button button-primary button-wide" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}<span aria-hidden="true">→</span></button>
        </form>
        <div className="auth-links"><Link href="/forgot-password">Forgot password?</Link><span>Access is monitored and audited.</span></div>
      </section>
    </main>
  );
}
