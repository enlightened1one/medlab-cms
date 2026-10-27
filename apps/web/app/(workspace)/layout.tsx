'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { can, type User } from '@/lib/types';
import type { Permission } from '@medlab/shared-types';

const navigation = [
  { label: 'Overview', href: '/dashboard', permission: 'stats:read' as Permission, icon: '◫' },
  { label: 'Patients', href: '/patients', permission: 'patients:read' as Permission, icon: '♙' },
  { label: 'Lab requests', href: '/requests', permission: 'requests:read' as Permission, icon: '▤' },
  { label: 'Specimens', href: '/specimens', permission: 'specimens:read' as Permission, icon: '◉' },
  { label: 'Results', href: '/results', permission: 'results:read' as Permission, icon: '⌁' },
  { label: 'Reports', href: '/reports', permission: 'reports:read' as Permission, icon: '▧' },
  { label: 'Test catalogue', href: '/catalogue', permission: 'tests:read' as Permission, icon: '⊞' },
  { label: 'Predictions', href: '/predictions', permission: 'predictions:read' as Permission, icon: '✳' },
  { label: 'User administration', href: '/users', permission: 'users:manage' as Permission, icon: '♧' },
  { label: 'Audit log', href: '/audit-logs', permission: 'audit:read' as Permission, icon: '≡' },
];

const roleLabel: Record<User['role'], string> = {
  ADMINISTRATOR: 'Administrator',
  LABORATORY_SCIENTIST: 'Laboratory scientist',
  CLINICIAN: 'Clinician',
};

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    let active = true;
    apiFetch<{ user: User }>('/auth/me')
      .then(result => { if (active) setUser(result.user); })
      .catch(() => { if (active) router.replace('/login'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [router]);

  const visibleNavigation = useMemo(
    () => user ? navigation.filter(item => can(user, item.permission)) : [],
    [user],
  );
  const displayName = user?.fullName?.trim() || user?.email || 'User';
  const initials = displayName.split(/\s+/).map(part => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

  async function signOut() {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
      router.replace('/login');
    } catch {
      window.alert('Sign out could not reach the server. Check your connection and try again.');
    }
  }

  if (loading || !user) {
    return <main className="loading-screen"><div className="loading-brand"><span className="brand-mark">M</span> MedLab</div><div className="loading-bar" /><p>Securing your workspace…</p></main>;
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <Link className="brand-lockup sidebar-brand" href="/dashboard" onClick={() => setMenuOpen(false)}>
          <span className="brand-mark">M</span><span>MedLab<span className="brand-light"> workspace</span></span>
        </Link>
        <div className="facility-label"><span className="status-dot" /> LABORATORY SYSTEM</div>
        <nav className="side-nav" aria-label="Main navigation">
          {visibleNavigation.map(item => {
            const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(`${item.href}/`));
            return <Link key={item.href} href={item.href} className={`nav-item ${active ? 'nav-active' : ''}`} onClick={() => setMenuOpen(false)}><span className="nav-icon" aria-hidden="true">{item.icon}</span><span>{item.label}</span>{active && <span className="nav-indicator" />}</Link>;
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-chip"><span className="privacy-icon">⌑</span><span><strong>Private by design</strong><small>Access is role restricted</small></span></div>
          <button className="user-card" onClick={signOut} aria-label={`Sign out ${displayName}`}>
            <span className="avatar">{initials}</span>
            <span className="user-meta"><strong>{displayName}</strong><small>{roleLabel[user.role]}</small></span>
            <span className="signout-icon" aria-hidden="true">↗</span>
          </button>
        </div>
      </aside>
      {menuOpen && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <div className="main-column">
        <header className="topbar">
          <button className="mobile-menu button-icon" aria-label="Open navigation" onClick={() => setMenuOpen(true)}>☰</button>
          <div className="breadcrumb"><span>Workspace</span><span className="breadcrumb-separator">/</span><strong>{navigation.find(item => item.href === pathname)?.label ?? 'Laboratory operations'}</strong></div>
          <div className="topbar-right"><span className="connection-state"><span className="status-dot" /> Secure session</span><span className="topbar-date">{new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date())}</span></div>
        </header>
        <main className="workspace-main">{children}</main>
        <footer className="app-footer"><span>MedLab · Laboratory operations</span><span>Educational system · Clinical governance review required</span></footer>
      </div>
    </div>
  );
}
