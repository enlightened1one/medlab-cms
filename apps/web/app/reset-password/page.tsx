'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

export default function ResetPasswordPage() {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get('token') ?? '');
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await apiFetch('/auth/reset-password', { method: 'POST', body: { token, newPassword: password } });
      setComplete(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to reset your password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-aside"><div className="brand-lockup"><span className="brand-mark">M</span><span>MedLab<span className="brand-light"> workspace</span></span></div><div className="auth-message"><span className="eyebrow">ACCOUNT SECURITY</span><h1>A fresh start, securely.</h1><p>Choose a strong password that protects your access and patient information.</p></div><div className="auth-note"><span className="status-dot" /> Secure access · Role-based workspace</div></div>
      <section className="auth-card">
        <Link className="back-link" href="/login">← Back to sign in</Link>
        <span className="eyebrow">PASSWORD RECOVERY</span>
        <h2>Create a new password</h2>
        {complete ? <div role="status" className="notice notice-success">Password updated. You can now sign in.</div> : (
          <form className="form-stack" onSubmit={submit}>
            <label>New password<input autoComplete="new-password" type="password" required minLength={12} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} /><small>12–128 characters, with uppercase, lowercase, and a number.</small></label>
            <label>Confirm password<input autoComplete="new-password" type="password" required minLength={12} maxLength={128} value={confirm} onChange={event => setConfirm(event.target.value)} /></label>
            {error && <div role="alert" className="notice notice-error">{error}</div>}
            <button className="button button-primary button-wide" disabled={loading || !token}>{loading ? 'Updating…' : 'Update password'}<span aria-hidden="true">→</span></button>
            {!token && <p className="field-error">Reset link is missing or invalid. Request a new one.</p>}
          </form>
        )}
      </section>
    </main>
  );
}
