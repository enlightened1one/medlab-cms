'use client';

import Link from 'next/link';
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { apiBlob, apiFetch, apiUrl } from '@/lib/api';
import { can, type AuditEntry, type DashboardStats, type Gender, type LabRequest, type Page, type Patient, type Prediction, type Report, type Role, type Specimen, type TestItem, type User } from '@/lib/types';

type Props = { section: string };
type ToastState = { message: string; tone?: 'success' | 'error' };
type LoadState = 'loading' | 'ready' | 'error';

const sectionContent: Record<string, { title: string; eyebrow: string; description: string }> = {
  dashboard: { title: 'Good day', eyebrow: 'WORKSPACE OVERVIEW', description: 'A clear view of today’s laboratory operations.' },
  patients: { title: 'Patients', eyebrow: 'PATIENT DIRECTORY', description: 'Find patient records, review history, and manage demographics.' },
  requests: { title: 'Lab requests', eyebrow: 'ORDER MANAGEMENT', description: 'Track requested tests from intake through final reporting.' },
  specimens: { title: 'Specimens', eyebrow: 'SPECIMEN WORKFLOW', description: 'Monitor collection, receipt, processing, and specimen exceptions.' },
  results: { title: 'Results', eyebrow: 'RESULTS WORKBENCH', description: 'Enter, submit, validate, and amend laboratory results.' },
  reports: { title: 'Reports', eyebrow: 'FINAL REPORTS', description: 'Review released reports and open print-ready or PDF copies.' },
  catalogue: { title: 'Test catalogue', eyebrow: 'LABORATORY CATALOGUE', description: 'Browse available tests and their configured reference ranges.' },
  predictions: { title: 'Pattern explorer', eyebrow: 'EDUCATIONAL ML PROTOTYPE', description: 'Explore a synthetic-data-only CBC pattern classifier.' },
  users: { title: 'User administration', eyebrow: 'ACCESS MANAGEMENT', description: 'Provision accounts and manage roles and access.' },
  'audit-logs': { title: 'Audit log', eyebrow: 'SYSTEM ACTIVITY', description: 'Read-only record of audited administrative and clinical actions.' },
};

const classNames = (...values: Array<string | false | undefined>) => values.filter(Boolean).join(' ');
const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(value)) : '—';
const formatTimestamp = (value?: string | null) => value ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
const titleCase = (value?: string | null) => (value ?? '').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, char => char.toUpperCase()) || '—';
const fullName = (patient: Pick<Patient, 'firstName' | 'lastName'>) => `${patient.firstName} ${patient.lastName}`;

function PageHeader({ section, action }: { section: string; action?: ReactNode }) {
  const content = sectionContent[section] ?? sectionContent.dashboard;
  return <div className="page-head"><div><span className="eyebrow">{content.eyebrow}</span><h1>{content.title}</h1><p>{content.description}</p></div>{action && <div className="head-actions">{action}</div>}</div>;
}

function Panel({ title, subtitle, action, children, className }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={classNames('panel', className)}><div className="panel-head"><div><h2 className="panel-title">{title}</h2>{subtitle && <p className="panel-subtitle">{subtitle}</p>}</div>{action}</div>{children}</section>;
}

function Table({ columns, children, empty, emptyDescription }: { columns: string[]; children: ReactNode; empty: boolean; emptyDescription: string }) {
  if (empty) return <div className="empty-state"><span className="empty-icon">⌕</span><strong>Nothing to show yet</strong><p>{emptyDescription}</p></div>;
  return <div className="table-wrap"><table><thead><tr>{columns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}

function Status({ value }: { value?: string | null }) {
  const tone = ['COMPLETED', 'VALIDATED', 'AMENDED', 'FINAL', 'PROCESSED', 'RECEIVED', 'SUCCESS', 'NORMAL'].includes(value ?? '')
    ? 'status-good'
    : ['REJECTED', 'CANCELLED', 'CRITICAL_HIGH', 'CRITICAL_LOW', 'FAILURE', 'DENIED'].includes(value ?? '')
      ? 'status-danger'
      : ['URGENT', 'STAT', 'AWAITING_VALIDATION', 'SUBMITTED', 'HIGH', 'LOW', 'ABNORMAL'].includes(value ?? '')
        ? 'status-warn'
        : 'status-info';
  return <span className={`status-pill ${tone}`}>{titleCase(value)}</span>;
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header className="modal-head"><div><h2 id="modal-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="button button-icon" onClick={onClose} aria-label="Close dialog">×</button></header>{children}</section></div>;
}

function usePageData<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState('');
  const [reloadId, setReloadId] = useState(0);
  const refresh = useCallback(() => setReloadId(id => id + 1), []);

  useEffect(() => {
    let active = true;
    setState('loading');
    apiFetch<T>(path)
      .then(result => { if (active) { setData(result); setState('ready'); setError(''); } })
      .catch(reason => { if (active) { setState('error'); setError(reason instanceof Error ? reason.message : 'Unable to load this page.'); } });
    return () => { active = false; };
  }, [path, reloadId]);
  return { data, state, error, refresh };
}

function PageState({ state, error, onRetry }: { state: LoadState; error: string; onRetry: () => void }) {
  if (state === 'loading') return <div className="panel"><div className="empty-state"><span className="loading-bar" /><p>Loading secure workspace data…</p></div></div>;
  if (state === 'error') return <div className="error-banner" role="alert">{error}<button className="button button-secondary button-small" style={{ marginLeft: 12 }} onClick={onRetry}>Try again</button></div>;
  return null;
}

function MetricCard({ label, value, note, icon }: { label: string; value: number | string; note: string; icon: string }) {
  return <div className="metric-card"><div className="metric-top"><span>{label}</span><span className="metric-icon">{icon}</span></div><div className="metric-value">{value}</div><div className="metric-foot">{note}</div></div>;
}

function DashboardView() {
  const today = new Date();
  const [from, setFrom] = useState(new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(today.toISOString().slice(0, 10));
  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return params.toString();
  }, [from, to]);
  const { data, state, error, refresh } = usePageData<DashboardStats>(`/dashboard?${query}`);
  const { data: userData } = usePageData<{ user: User }>('/auth/me');

  return <>
    <PageHeader section="dashboard" action={<div className="date-filter"><label>From<input type="date" value={from} max={to} onChange={event => setFrom(event.target.value)} /></label><label>To<input type="date" value={to} min={from} max={today.toISOString().slice(0, 10)} onChange={event => setTo(event.target.value)} /></label><button className="button button-secondary button-small" onClick={refresh}>Refresh</button></div>} />
    {userData && <p className="welcome-line">Welcome back, <strong>{userData.user.fullName.split(' ')[0]}</strong>. Here’s the current picture of your service.</p>}
    <PageState state={state} error={error} onRetry={refresh} />
    {data && <>
      <div className="metric-grid">
        <MetricCard label="Patient records" value={data.patients} note="In the selected period" icon="♙" />
        <MetricCard label="Test catalogue" value={data.tests} note="Active investigations" icon="⊞" />
        <MetricCard label="Active requests" value={Object.entries(data.requests).filter(([status]) => !['COMPLETED', 'CANCELLED'].includes(status)).reduce((total, [, count]) => total + count, 0)} note="Not yet closed" icon="▤" />
        <MetricCard label="Final results" value={data.results.final ?? 0} note="Validated or amended" icon="⌁" />
      </div>
      <div className="dashboard-grid">
        <Panel title="Request pipeline" subtitle={`Laboratory orders · ${from} to ${to}`}>
          <div className="panel-body status-list">
            {['PENDING', 'SPECIMEN_COLLECTED', 'IN_PROGRESS', 'AWAITING_VALIDATION', 'COMPLETED', 'CANCELLED'].map(status => {
              const count = data.requests[status] ?? 0;
              const total = Object.values(data.requests).reduce((sum, value) => sum + value, 0);
              return <div className="status-row" key={status}><span>{titleCase(status)}</span><strong>{count}</strong><div className="bar-track"><div className="bar-fill" style={{ width: `${total ? Math.max(2, count / total * 100) : 0}%` }} /></div></div>;
            })}
          </div>
        </Panel>
        <div className="dashboard-stack">
          <Panel title="Specimen activity" subtitle="By current status"><div className="panel-body status-list">{Object.entries(data.specimens).length ? Object.entries(data.specimens).map(([status, count]) => <div className="status-row" key={status}><span>{titleCase(status)}</span><strong>{count}</strong></div>) : <p className="muted">No specimen activity in this range.</p>}</div></Panel>
          <Panel title="Result status" subtitle="All recorded results"><div className="panel-body status-list">{Object.entries(data.results).map(([status, count]) => <div className="status-row" key={status}><span>{titleCase(status)}</span><strong>{count}</strong></div>)}</div></Panel>
        </div>
      </div>
      <p className="clinical-note">Dashboard figures are sourced from operational records and are limited to your access scope.</p>
    </>}
  </>;
}

function PatientsView({ user, onToast }: { user: User; onToast: (toast: ToastState) => void }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const query = useMemo(() => new URLSearchParams({ page: String(page), pageSize: '20', ...(search ? { search } : {}) }).toString(), [page, search]);
  const { data, state, error, refresh } = usePageData<Page<Patient>>(`/patients?${query}`);
  const [modal, setModal] = useState(false);
  const [history, setHistory] = useState<{ patient: Patient; items: LabRequest[] } | null>(null);
  const writable = can(user, 'patients:write');

  async function createPatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await apiFetch<Patient>('/patients', { method: 'POST', body: {
        firstName: String(form.get('firstName')).trim(), lastName: String(form.get('lastName')).trim(),
        gender: String(form.get('gender')) || 'UNKNOWN',
        ...(form.get('dateOfBirth') ? { dateOfBirth: String(form.get('dateOfBirth')) } : {}),
        ...(form.get('phone') ? { phone: String(form.get('phone')).trim() } : {}),
      } });
      setModal(false); refresh(); onToast({ message: 'Patient record created.' });
    } catch (reason) { onToast({ message: reason instanceof Error ? reason.message : 'Could not create patient.', tone: 'error' }); }
  }

  async function openHistory(patient: Patient) {
    try {
      const result = await apiFetch<Page<LabRequest>>(`/patients/${patient.id}/history?page=1&pageSize=20`);
      setHistory({ patient, items: result.items });
    } catch (reason) { onToast({ message: reason instanceof Error ? reason.message : 'Could not load patient history.', tone: 'error' }); }
  }

  async function archive(patient: Patient) {
    if (!window.confirm(`Archive ${fullName(patient)}? The record will remain in the clinical history.`)) return;
    try {
      await apiFetch(`/patients/${patient.id}/archive`, { method: 'POST' });
      refresh(); onToast({ message: 'Patient record archived.' });
    } catch (reason) { onToast({ message: reason instanceof Error ? reason.message : 'Could not archive patient.', tone: 'error' }); }
  }

  return <>
    <PageHeader section="patients" action={writable ? <button className="button button-primary" onClick={() => setModal(true)}><span>＋</span> Add patient</button> : undefined} />
    <Panel title="Patient directory" subtitle={`${data?.total ?? 0} records`}>
      <div className="toolbar"><input className="toolbar-search" aria-label="Search patients" placeholder="Search name or patient number…" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /><span className="muted" style={{ fontSize: 10 }}>Search is limited to the records you’re allowed to see.</span></div>
      <PageState state={state} error={error} onRetry={refresh} />
      {data && <Table columns={['Patient', 'Demographics', 'Contact', 'Added', 'Actions']} empty={!data.items.length} emptyDescription="Add a patient or adjust your search to see matching records.">
        {data.items.map(patient => <tr key={patient.id}><td><span className="table-primary">{fullName(patient)}</span><span className="table-secondary">{patient.patientNumber}</span></td><td>{titleCase(patient.gender)}<span className="table-secondary">{patient.dateOfBirth ? formatDate(patient.dateOfBirth) : 'Date of birth not recorded'}</span></td><td>{patient.phone ?? '—'}</td><td>{formatDate(patient.createdAt)}</td><td><div className="row-actions"><button className="button button-secondary button-small" onClick={() => void openHistory(patient)}>History</button>{writable && !patient.archivedAt && <button className="button button-danger button-small" onClick={() => void archive(patient)}>Archive</button>}</div></td></tr>)}
      </Table>}
      {data && <Pagination data={data} page={page} setPage={setPage} />}
    </Panel>
    {modal && <Modal title="Create patient record" subtitle="Patient numbers are assigned by the system." onClose={() => setModal(false)}><form className="modal-body" onSubmit={createPatient}><div className="form-grid"><label>First name<input name="firstName" required maxLength={80} autoFocus /></label><label>Last name<input name="lastName" required maxLength={80} /></label><label>Gender<select name="gender" defaultValue="UNKNOWN"><option>UNKNOWN</option><option>FEMALE</option><option>MALE</option><option>OTHER</option></select></label><label>Date of birth<input name="dateOfBirth" type="date" max={new Date().toISOString().slice(0, 10)} /></label><label className="span-2">Phone number<input name="phone" type="tel" maxLength={40} /></label></div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setModal(false)}>Cancel</button><button className="button button-primary">Create patient</button></div></form></Modal>}
    {history && <Modal title={fullName(history.patient)} subtitle={`${history.patient.patientNumber} · Request history`} onClose={() => setHistory(null)}><div className="modal-body"><Table columns={['Request', 'Date', 'Tests', 'Status']} empty={!history.items.length} emptyDescription="No requests are visible in this patient’s history.">{history.items.map(request => <tr key={request.id}><td><strong>{request.requestNumber}</strong></td><td>{formatDate(request.requestDate)}</td><td>{request.items.map(item => item.test.code).join(', ')}</td><td><Status value={request.status} /></td></tr>)}</Table></div></Modal>}
  </>;
}

function Pagination<T>({ data, page, setPage }: { data: Page<T>; page: number; setPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return <div className="pagination"><span>Showing {data.total ? (page - 1) * data.pageSize + 1 : 0}–{Math.min(page * data.pageSize, data.total)} of {data.total}</span><div className="pagination-actions"><button className="button button-secondary button-small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button className="button button-secondary button-small" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div></div>;
}

function RequestsView({ user, onToast }: { user: User; onToast: (toast: ToastState) => void }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const query = useMemo(() => new URLSearchParams({ page: String(page), pageSize: '20', ...(status ? { status } : {}) }).toString(), [page, status]);
  const { data, state, error, refresh } = usePageData<Page<LabRequest>>(`/requests?${query}`);
  const [modal, setModal] = useState(false);
  const [selected, setSelected] = useState<LabRequest | null>(null);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [tests, setTests] = useState<TestItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const creatable = can(user, 'requests:create');

  async function openCreate() {
    if (!idempotencyKey) setIdempotencyKey(crypto.randomUUID());
    setModal(true);
    try {
      const [patientPage, catalogue] = await Promise.all([
        apiFetch<Page<Patient>>('/patients?page=1&pageSize=100'),
        apiFetch<TestItem[]>('/tests'),
      ]);
      setPatients(patientPage.items); setTests(catalogue.filter(test => test.isActive));
    } catch (reason) {
      setModal(false); onToast({ message: reason instanceof Error ? reason.message : 'Could not load patients and tests.', tone: 'error' });
    }
  }

  async function createRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    const form = new FormData(event.currentTarget);
    const testIds = form.getAll('testIds').map(String);
    if (!testIds.length) { onToast({ message: 'Choose at least one test.', tone: 'error' }); return; }
    if (!idempotencyKey) { onToast({ message: 'Request key is unavailable. Close and reopen the form.', tone: 'error' }); return; }
    setCreating(true);
    try {
      await apiFetch<LabRequest>('/requests', {
        method: 'POST',
        idempotencyKey,
        body: { patientId: String(form.get('patientId')), testIds, priority: String(form.get('priority')), clinicalNotes: String(form.get('clinicalNotes') ?? '').trim() },
      });
      setModal(false); setIdempotencyKey(null); refresh(); onToast({ message: 'Laboratory request submitted.' });
    } catch (reason) { onToast({ message: reason instanceof Error ? reason.message : 'Could not create request.', tone: 'error' }); }
    finally { setCreating(false); }
  }

  async function openRequest(request: LabRequest) {
    try {
      setSelected(await apiFetch<LabRequest>(`/requests/${request.id}`));
    } catch (reason) { onToast({ message: reason instanceof Error ? reason.message : 'Could not load request details.', tone: 'error' }); }
  }

  async function cancelRequest(request: LabRequest) {
    if (!window.confirm(`Cancel ${request.requestNumber}? This cannot be undone.`)) return;
    try {
      await apiFetch(`/requests/${request.id}/status`, { method: 'PATCH', body: { status: 'CANCELLED', expectedVersion: request.version } });
      setSelected(null); refresh(); onToast({ message: 'Request cancelled.' });
    } catch (reason) { onToast({ message: reason instanceof Error ? reason.message : 'Could not cancel request.', tone: 'error' }); }
  }

  return <>
    <PageHeader section="requests" action={creatable ? <button className="button button-primary" onClick={() => void openCreate()}>＋ New request</button> : undefined} />
    <Panel title="Request worklist" subtitle={`${data?.total ?? 0} laboratory requests`}>
      <div className="toolbar"><select className="toolbar-select" aria-label="Filter by request status" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option>{['PENDING', 'SPECIMEN_COLLECTED', 'IN_PROGRESS', 'AWAITING_VALIDATION', 'COMPLETED', 'CANCELLED'].map(item => <option key={item}>{item}</option>)}</select></div>
      <PageState state={state} error={error} onRetry={refresh} />
      {data && <Table columns={['Request', 'Patient', 'Tests', 'Priority', 'Status', 'Date', 'Actions']} empty={!data.items.length} emptyDescription="New requests will appear here as soon as they are submitted.">
        {data.items.map(request => <tr key={request.id}><td><span className="table-primary">{request.requestNumber}</span><span className="table-secondary">{request.specimens.length} specimen{request.specimens.length === 1 ? '' : 's'}</span></td><td><span className="table-primary">{fullName(request.patient)}</span><span className="table-secondary">{request.patient.patientNumber}</span></td><td>{request.items.map(item => item.test.code).join(', ')}</td><td><Status value={request.priority} /></td><td><Status value={request.status} /></td><td>{formatDate(request.requestDate)}</td><td><button className="button button-secondary button-small" onClick={() => void openRequest(request)}>Review</button></td></tr>)}
      </Table>}
      {data && <Pagination data={data} page={page} setPage={setPage} />}
    </Panel>
    {modal && <Modal title="New laboratory request" subtitle="Select an active patient and the requested investigations." onClose={() => setModal(false)}><form className="modal-body" onSubmit={createRequest}><label>Patient<select name="patientId" required defaultValue=""><option value="" disabled>Select patient</option>{patients.filter(patient => !patient.archivedAt).map(patient => <option key={patient.id} value={patient.id}>{patient.patientNumber} · {fullName(patient)}</option>)}</select></label><div><span className="form-label">Requested tests</span><div className="checkbox-grid">{tests.map(test => <label className="check-card" key={test.id}><input type="checkbox" name="testIds" value={test.id} /><span><strong>{test.name}</strong><small>{test.code} · {test.specimenType}</small></span></label>)}</div></div><div className="form-grid"><label>Priority<select name="priority" defaultValue="ROUTINE"><option>ROUTINE</option><option>URGENT</option><option>STAT</option></select></label><label>Clinical note<input name="clinicalNotes" maxLength={2000} placeholder="Optional" /></label></div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setModal(false)}>Cancel</button><button className="button button-primary" disabled={!patients.length || !tests.length || creating}>{creating ? 'Submitting…' : 'Submit request'}</button></div></form></Modal>}
    {selected && <Modal title={selected.requestNumber} subtitle={`${fullName(selected.patient)} · ${selected.patient.patientNumber}`} onClose={() => setSelected(null)}><div className="modal-body"><div className="detail-grid"><div className="detail-list"><div className="detail-line"><span>Request status</span><Status value={selected.status} /></div><div className="detail-line"><span>Priority</span><strong>{titleCase(selected.priority)}</strong></div><div className="detail-line"><span>Requested</span><strong>{formatTimestamp(selected.requestDate)}</strong></div><div className="detail-line"><span>Requested by</span><strong>{selected.requestedBy?.fullName ?? '—'}</strong></div></div><div className="detail-list"><strong className="table-primary">Specimens</strong>{selected.specimens.map(specimen => <div className="detail-line" key={specimen.id}><span>{specimen.specimenNumber} · {specimen.specimenType}</span><Status value={specimen.status} /></div>)}</div></div><Table columns={['Test', 'Result', 'Status']} empty={!selected.items.length} emptyDescription="No tests are attached to this request.">{selected.items.map(item => <tr key={item.id}><td><span className="table-primary">{item.test.name}</span><span className="table-secondary">{item.test.code}</span></td><td>{item.result?.numericValue ?? item.result?.textValue ?? '—'} {item.result?.unit ?? item.test.unit}</td><td>{item.result ? <Status value={item.result.status} /> : <span className="muted">Not entered</span>}</td></tr>)}</Table><div className="modal-actions"><button className="button button-secondary" onClick={() => setSelected(null)}>Close</button>{can(user, 'requests:cancel') && !['COMPLETED', 'CANCELLED'].includes(selected.status) && <button className="button button-danger" onClick={() => void cancelRequest(selected)}>Cancel request</button>}</div></div></Modal>}
  </>;
}

type SpecimenRow = {
  id: string;
  specimenNumber: string;
  requestId: string;
  patient: Pick<Patient, 'patientNumber' | 'firstName' | 'lastName'>;
  request: { requestNumber: string; status: string };
  specimenType: string;
  status: Specimen['status'];
  collectedAt: string | null;
  receivedAt: string | null;
  rejectionReason: string | null;
  version: number;
};

const specimenNext: Partial<Record<Specimen['status'], Specimen['status'][]>> = {
  REGISTERED: ['COLLECTED', 'CANCELLED'],
  COLLECTED: ['RECEIVED', 'REJECTED', 'CANCELLED'],
  RECEIVED: ['PROCESSING', 'REJECTED', 'CANCELLED'],
  PROCESSING: ['PROCESSED', 'REJECTED', 'CANCELLED'],
};

function SpecimensView({ user, onToast }: { user: User; onToast: (toast: ToastState) => void }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const query = useMemo(() => new URLSearchParams({ page: String(page), pageSize: '20', ...(status ? { status } : {}) }).toString(), [page, status]);
  const { data, state, error, refresh } = usePageData<Page<SpecimenRow>>(`/specimens?${query}`);

  async function transition(specimen: SpecimenRow) {
    const options = specimenNext[specimen.status] ?? [];
    if (!options.length) return;
    const choice = window.prompt(`Next status (${options.join(', ')}):`, options[0]);
    if (!choice || !options.includes(choice as Specimen['status'])) return;
    const rejectionReason = choice === 'REJECTED' ? window.prompt('Enter the required rejection reason:') : null;
    if (choice === 'REJECTED' && !rejectionReason?.trim()) {
      onToast({ message: 'A rejection reason is required.', tone: 'error' });
      return;
    }
    try {
      await apiFetch(`/specimens/${specimen.id}/status`, {
        method: 'PATCH',
        body: { status: choice, expectedVersion: specimen.version, ...(rejectionReason ? { rejectionReason: rejectionReason.trim() } : {}) },
      });
      refresh(); onToast({ message: `Specimen moved to ${titleCase(choice)}.` });
    } catch (reason) { onToast({ message: reason instanceof Error ? reason.message : 'Could not update specimen.', tone: 'error' }); }
  }

  return <>
    <PageHeader section="specimens" />
    <Panel title="Specimen worklist" subtitle={`${data?.total ?? 0} specimens`}>
      <div className="toolbar"><select className="toolbar-select" aria-label="Filter specimens" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option>{['REGISTERED', 'COLLECTED', 'RECEIVED', 'PROCESSING', 'PROCESSED', 'REJECTED', 'CANCELLED'].map(item => <option key={item}>{item}</option>)}</select></div>
      <PageState state={state} error={error} onRetry={refresh} />
      {data && <Table columns={['Specimen', 'Patient / request', 'Type', 'Collected / received', 'Status', 'Actions']} empty={!data.items.length} emptyDescription="Specimens are created automatically when a request is submitted.">
        {data.items.map(specimen => <tr key={specimen.id}><td><span className="table-primary">{specimen.specimenNumber}</span></td><td><span className="table-primary">{fullName(specimen.patient)}</span><span className="table-secondary">{specimen.patient.patientNumber} · {specimen.request.requestNumber}</span></td><td>{specimen.specimenType}</td><td>{formatDate(specimen.collectedAt)}<span className="table-secondary">Received {formatDate(specimen.receivedAt)}</span></td><td><Status value={specimen.status} />{specimen.rejectionReason && <span className="table-secondary">{specimen.rejectionReason}</span>}</td><td>{can(user, 'specimens:write') && (specimenNext[specimen.status]?.length ?? 0) > 0 && <button className="button button-secondary button-small" onClick={() => void transition(specimen)}>Update</button>}</td></tr>)}
      </Table>}
      {data && <Pagination data={data} page={page} setPage={setPage} />}
    </Panel>
  </>;
}

type ResultRow = {
  id: string;
  numericValue: number | string | null;
  textValue: string | null;
  unit: string | null;
  flag: string | null;
  status: 'DRAFT' | 'SUBMITTED' | 'VALIDATED' | 'AMENDED';
  version: number;
  comment: string | null;
  requestItem: { id: string; test: { code: string; name: string; unit: string | null }; request: { id: string; requestNumber: string; patientId: string; requestedById: string; status: string } };
  specimen: { specimenNumber: string; status: string };
};

function ResultsView({ user, onToast }: { user: User; onToast: (toast: ToastState) => void }) {
  const [page, setPage] = useState(1);
  const { data, state, error, refresh } = usePageData<Page<ResultRow>>(`/results?page=${page}&pageSize=20`);
  const [requests, setRequests] = useState<LabRequest[]>([]);
  const [modal, setModal] = useState<{ item?: LabRequest['items'][number]; result?: ResultRow } | null>(null);
  const hasEntry = can(user, 'results:enter');

  async function openEntry(result?: ResultRow) {
    try {
      const requestPage = await apiFetch<Page<LabRequest>>('/requests?page=1&pageSize=100');
      setRequests(requestPage.items);
      setModal({ result });
    } catch (reason) { onToast({ message: reason instanceof Error ? reason.message : 'Could not load result worklist.', tone: 'error' }); }
  }

  async function saveResult(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modal) return;
    const form = new FormData(event.currentTarget);
    const requestItemId = modal.result?.requestItem.id ?? String(form.get('requestItemId'));
    const item = requests.flatMap(request => request.items).find(candidate => candidate.id === requestItemId);
    if (!item) { onToast({ message: 'Select a request test.', tone: 'error' }); return; }
    const specimenId = String(form.get('specimenId') ?? '');
    const rawValue = String(form.get('value') ?? '').trim();
    if (!rawValue) { onToast({ message: 'Enter a result value.', tone: 'error' }); return; }
    const value = item.test.resultType === 'NUMERIC' ? Number(rawValue) : rawValue;
    if (typeof value === 'number' && !Number.isFinite(value)) { onToast({ message: 'Enter a valid numeric result.', tone: 'error' }); return; }
    try {
      await apiFetch('/results', { method: 'POST', body: {
        requestItemId, specimenId,
        ...(typeof value === 'number' ? { numericValue: value } : { textValue: value }),
        comment: String(form.get('comment') ?? '').trim(),
        ...(modal.result ? { expectedVersion: modal.result.version } : {}),
      } });
      setModal(null); refresh(); onToast({ message: 'Draft result saved.' });
    } catch (reason) { onToast({ message: reason instanceof Error ? reason.message : 'Could not save result.', tone: 'error' }); }
  }

  async function changeStatus(result: ResultRow, action: 'submit' | 'validate') {
    try {
      await apiFetch(`/results/${result.id}/${action}`, { method: 'POST', body: { expectedVersion: result.version } });
      refresh(); onToast({ message: action === 'submit' ? 'Result submitted for validation.' : 'Result validated.' });
    } catch (reason) { onToast({ message: reason instanceof Error ? reason.message : 'Could not update result.', tone: 'error' }); }
  }

  async function amend(result: ResultRow) {
    const reason = window.prompt('Enter the reason for this amendment:');
    if (!reason?.trim()) { onToast({ message: 'An amendment reason is required.', tone: 'error' }); return; }
    const currentValue = result.numericValue ?? result.textValue ?? '';
    const newValue = window.prompt('Enter the amended result value:', String(currentValue));
    if (newValue === null || !newValue.trim()) return;
    const numeric = result.numericValue !== null;
    const converted = numeric ? Number(newValue) : newValue;
    if (typeof converted === 'number' && !Number.isFinite(converted)) { onToast({ message: 'Enter a valid numeric result.', tone: 'error' }); return; }
    try {
      await apiFetch(`/results/${result.id}/amend`, { method: 'PATCH', body: {
        expectedVersion: result.version, reason: reason.trim(),
        ...(typeof converted === 'number' ? { numericValue: converted } : { textValue: converted }),
      } });
      refresh(); onToast({ message: 'Result amended and previous state preserved.' });
    } catch (reasonValue) { onToast({ message: reasonValue instanceof Error ? reasonValue.message : 'Could not amend result.', tone: 'error' }); }
  }

  const enterableItems = requests.flatMap(request => request.items.filter(item => !item.result || item.result.status === 'DRAFT')
    .map(item => ({ request, item, specimens: request.specimens.filter(specimen => ['PROCESSING', 'PROCESSED'].includes(specimen.status) && specimen.specimenType === item.test.specimenType) })))
    .filter(row => row.specimens.length > 0);

  return <>
    <PageHeader section="results" action={hasEntry ? <button className="button button-primary" onClick={() => void openEntry()}>＋ Enter result</button> : undefined} />
    <div className="notice notice-warning" style={{ marginBottom: 15 }}>Only validated results appear in clinician reports. Amendments retain a revision of the prior result.</div>
    <Panel title="Result worklist" subtitle={`${data?.total ?? 0} results`}>
      <PageState state={state} error={error} onRetry={refresh} />
      {data && <Table columns={['Test / patient', 'Result', 'Reference flag', 'Specimen', 'Status', 'Actions']} empty={!data.items.length} emptyDescription="There are no result records yet. Eligible tests appear when a specimen reaches processing.">
        {data.items.map(result => <tr key={result.id}><td><span className="table-primary">{result.requestItem.test.name}</span><span className="table-secondary">{result.requestItem.request.requestNumber} · {result.requestItem.test.code}</span></td><td><strong>{result.numericValue ?? result.textValue ?? '—'}</strong> {result.unit}</td><td>{result.flag ? <Status value={result.flag} /> : '—'}</td><td><span className="table-primary">{result.specimen.specimenNumber}</span><span className="table-secondary">{titleCase(result.specimen.status)}</span></td><td><Status value={result.status} /></td><td><div className="row-actions">{hasEntry && result.status === 'DRAFT' && <><button className="button button-secondary button-small" onClick={() => void openEntry(result)}>Edit</button><button className="button button-secondary button-small" onClick={() => void changeStatus(result, 'submit')}>Submit</button></>}{can(user, 'results:validate') && result.status === 'SUBMITTED' && <button className="button button-primary button-small" onClick={() => void changeStatus(result, 'validate')}>Validate</button>}{can(user, 'results:amend') && result.status === 'VALIDATED' && <button className="button button-secondary button-small" onClick={() => void amend(result)}>Amend</button>}</div></td></tr>)}
      </Table>}
      {data && <Pagination data={data} page={page} setPage={setPage} />}
    </Panel>
    {modal && <Modal title={modal.result ? 'Edit draft result' : 'Enter a result'} subtitle="Values are checked against the selected test and specimen." onClose={() => setModal(null)}><form className="modal-body" onSubmit={saveResult}><label>Request test<select required name="requestItemId" disabled={Boolean(modal.result)} defaultValue={modal.result?.requestItem.id ?? ''}><option value="" disabled>Select request and test</option>{enterableItems.map(({ request, item }) => <option key={item.id} value={item.id}>{request.requestNumber} · {request.patient.patientNumber} · {item.test.name}</option>)}</select></label><label>Specimen<select required name="specimenId" defaultValue={modal.result ? requests.flatMap(request => request.specimens).find(specimen => specimen.specimenNumber === modal.result?.specimen.specimenNumber)?.id : ''}><option value="" disabled>Select specimen</option>{(modal.result ? requests.flatMap(request => request.specimens) : enterableItems.flatMap(row => row.specimens)).filter((specimen, index, list) => list.findIndex(candidate => candidate.id === specimen.id) === index).map(specimen => <option key={specimen.id} value={specimen.id}>{specimen.specimenNumber} · {specimen.specimenType} · {titleCase(specimen.status)}</option>)}</select></label><label>Result value<input name="value" required inputMode="decimal" defaultValue={modal.result?.numericValue ?? modal.result?.textValue ?? ''} maxLength={2000} /></label><label>Comment<textarea name="comment" maxLength={1000} defaultValue={modal.result?.comment ?? ''} /></label><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setModal(null)}>Cancel</button><button className="button button-primary">Save draft</button></div></form></Modal>}
  </>;
}

type ReportRequest = LabRequest & { report?: { id: string; reportNumber: string; status: string; version: number } | null };

function ReportsView({ user, onToast }: { user: User; onToast: (toast: ToastState) => void }) {
  const [page, setPage] = useState(1);
  const { data, state, error, refresh } = usePageData<Page<Report>>(`/reports?page=${page}&pageSize=20`);
  const { data: requestsData, refresh: refreshRequests } = usePageData<Page<ReportRequest>>('/requests?page=1&pageSize=100');
  const generatable = can(user, 'reports:generate');

  async function generate(request: ReportRequest) {
    const finalResults = request.items.every(item => ['VALIDATED', 'AMENDED'].includes(item.result?.status ?? ''));
    if (!finalResults) { onToast({ message: 'Every test needs a validated result before a final report is generated.', tone: 'error' }); return; }
    if (!window.confirm(`${request.report ? 'Amend' : 'Generate'} the final report for ${request.requestNumber}?`)) return;
    try {
      await apiFetch(`/reports/request/${request.id}/generate`, { method: 'POST', body: request.report ? { expectedVersion: request.report.version } : {} });
      refresh(); refreshRequests(); onToast({ message: request.report ? 'Report amendment issued.' : 'Final report generated.' });
    } catch (reason) { onToast({ message: reason instanceof Error ? reason.message : 'Could not generate report.', tone: 'error' }); }
  }

  async function download(report: Report) {
    try {
      const file = await apiBlob(`/reports/${report.id}/pdf`);
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url; link.download = `${report.reportNumber}.pdf`; link.click();
      URL.revokeObjectURL(url);
    } catch (reason) { onToast({ message: reason instanceof Error ? reason.message : 'Could not download report.', tone: 'error' }); }
  }

  return <>
    <PageHeader section="reports" />
    <div className="notice notice-warning" style={{ marginBottom: 15 }}>A report is available only after every requested test has a validated result. Draft or submitted values are never presented as final.</div>
    {generatable && requestsData && requestsData.items.some(request => ['AWAITING_VALIDATION', 'COMPLETED'].includes(request.status)) && <Panel title="Ready for report" subtitle="Requests with final results can be released or amended." className="ready-panel"><Table columns={['Request', 'Patient', 'Status', 'Tests', 'Action']} empty={!requestsData.items.some(request => ['AWAITING_VALIDATION', 'COMPLETED'].includes(request.status))} emptyDescription="No requests are ready for a final report.">{requestsData.items.filter(request => ['AWAITING_VALIDATION', 'COMPLETED'].includes(request.status)).map(request => <tr key={request.id}><td><strong>{request.requestNumber}</strong></td><td>{request.patient.patientNumber} · {fullName(request.patient)}</td><td><Status value={request.status} /></td><td>{request.items.filter(item => ['VALIDATED', 'AMENDED'].includes(item.result?.status ?? '')).length}/{request.items.length} validated</td><td><button className="button button-secondary button-small" onClick={() => void generate(request)}>{request.report ? 'Amend report' : 'Generate'}</button></td></tr>)}</Table></Panel>}
    <Panel title="Issued reports" subtitle={`${data?.total ?? 0} final reports`} className={generatable ? 'reports-panel' : undefined}>
      <PageState state={state} error={error} onRetry={refresh} />
      {data && <Table columns={['Report', 'Patient', 'Request', 'Issued', 'Status', 'Actions']} empty={!data.items.length} emptyDescription="Issued reports will appear here when all request results are validated.">
        {data.items.map(report => <tr key={report.id}><td><span className="table-primary">{report.reportNumber}</span><span className="table-secondary">Version {report.version}</span></td><td>{fullName(report.request.patient)}<span className="table-secondary">{report.request.patient.patientNumber}</span></td><td>{report.request.requestNumber}</td><td>{formatTimestamp(report.issuedAt)}</td><td><Status value={report.status} /></td><td><div className="row-actions"><button className="button button-secondary button-small" onClick={() => void download(report)}>PDF</button><a className="button button-secondary button-small" href={apiUrl(`/reports/${report.id}/print`)} target="_blank" rel="noreferrer">Print view</a></div></td></tr>)}
      </Table>}
      {data && <Pagination data={data} page={page} setPage={setPage} />}
    </Panel>
  </>;
}

type Range = { id: string; sex: Gender | null; ageMinYears: number | null; ageMaxYears: number | null; lowValue: string | number | null; highValue: string | number | null; criticalLow: string | number | null; criticalHigh: string | number | null; textRange: string | null; note: string | null };
type CatalogueTest = TestItem & { referenceRanges: Range[] };

function CatalogueView({ user, onToast }: { user: User; onToast: (toast: ToastState) => void }) {
  const [search, setSearch] = useState('');
  const query = useMemo(() => new URLSearchParams(search ? { search } : {}).toString(), [search]);
  const { data, state, error, refresh } = usePageData<CatalogueTest[]>(`/tests${query ? `?${query}` : ''}`);
  const [createOpen, setCreateOpen] = useState(false);
  const [rangeTest, setRangeTest] = useState<CatalogueTest | null>(null);
  const manager = can(user, 'tests:manage');

  async function createTest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await apiFetch('/tests', { method: 'POST', body: { code: String(form.get('code')).trim().toUpperCase(), name: String(form.get('name')).trim(), category: String(form.get('category')).trim(), specimenType: String(form.get('specimenType')).trim(), unit: String(form.get('unit') ?? '').trim(), resultType: String(form.get('resultType')), decimalPlaces: Number(form.get('decimalPlaces')) } });
      setCreateOpen(false); refresh(); onToast({ message: 'Test catalogue item created.' });
    } catch (reason) { onToast({ message: reason instanceof Error ? reason.message : 'Could not create test.', tone: 'error' }); }
  }

  async function addRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rangeTest) return;
    const form = new FormData(event.currentTarget);
    const numeric = (name: string) => String(form.get(name)).trim() ? Number(form.get(name)) : undefined;
    const body = {
      sex: String(form.get('sex')) || undefined,
      ageMinYears: numeric('ageMinYears'), ageMaxYears: numeric('ageMaxYears'),
      lowValue: numeric('lowValue'), highValue: numeric('highValue'),
      criticalLow: numeric('criticalLow'), criticalHigh: numeric('criticalHigh'),
      textRange: String(form.get('textRange') ?? '').trim() || undefined,
      note: String(form.get('note') ?? '').trim() || undefined,
    };
    try {
      await apiFetch(`/tests/${rangeTest.id}/reference-ranges`, { method: 'POST', body });
      setRangeTest(null); refresh(); onToast({ message: 'Reference range added.' });
    } catch (reason) { onToast({ message: reason instanceof Error ? reason.message : 'Could not add reference range.', tone: 'error' }); }
  }

  return <>
    <PageHeader section="catalogue" action={manager ? <button className="button button-primary" onClick={() => setCreateOpen(true)}>＋ Add test</button> : undefined} />
    <Panel title="Available investigations" subtitle={`${data?.length ?? 0} tests in catalogue`}>
      <div className="toolbar"><input className="toolbar-search" aria-label="Search test catalogue" placeholder="Search code, test, or category…" value={search} onChange={event => setSearch(event.target.value)} /></div>
      <PageState state={state} error={error} onRetry={refresh} />
      {data && <Table columns={['Test', 'Category', 'Specimen', 'Result format', 'Reference ranges', 'Actions']} empty={!data.length} emptyDescription="No catalogue tests match your search.">
        {data.map(test => <tr key={test.id}><td><span className="table-primary">{test.name}</span><span className="table-secondary">{test.code}{test.unit ? ` · ${test.unit}` : ''}</span></td><td>{test.category}</td><td>{test.specimenType}</td><td>{titleCase(test.resultType)}{test.resultType === 'NUMERIC' ? ` · ${test.decimalPlaces} dp` : ''}</td><td>{test.referenceRanges.length ? test.referenceRanges.map(range => <span className="range-line" key={range.id}>{range.sex ? titleCase(range.sex) : 'All'}{range.ageMinYears !== null || range.ageMaxYears !== null ? ` · ${range.ageMinYears ?? '0'}–${range.ageMaxYears ?? '∞'}y` : ''}: {range.lowValue ?? range.textRange ?? '—'}{range.highValue !== null ? `–${range.highValue}` : ''} {test.unit ?? ''}</span>) : <span className="muted">Not configured</span>}</td><td>{manager && <button className="button button-secondary button-small" onClick={() => setRangeTest(test)}>Add range</button>}</td></tr>)}
      </Table>}
    </Panel>
    {createOpen && <Modal title="Add catalogue test" subtitle="The test will be available for new requests." onClose={() => setCreateOpen(false)}><form className="modal-body" onSubmit={createTest}><div className="form-grid"><label>Test code<input name="code" required maxLength={32} /></label><label>Display name<input name="name" required maxLength={120} /></label><label>Category<input name="category" required maxLength={80} /></label><label>Specimen type<input name="specimenType" required maxLength={120} /></label><label>Unit<input name="unit" maxLength={32} /></label><label>Result type<select name="resultType"><option>NUMERIC</option><option>TEXT</option></select></label><label>Decimal places<input name="decimalPlaces" type="number" min="0" max="6" defaultValue="2" /></label></div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setCreateOpen(false)}>Cancel</button><button className="button button-primary">Create test</button></div></form></Modal>}
    {rangeTest && <Modal title="Add reference range" subtitle={`${rangeTest.code} · ${rangeTest.name}`} onClose={() => setRangeTest(null)}><form className="modal-body" onSubmit={addRange}><div className="form-grid"><label>Applies to gender<select name="sex" defaultValue=""><option value="">All</option><option>FEMALE</option><option>MALE</option><option>OTHER</option><option>UNKNOWN</option></select></label><label>Age minimum<input name="ageMinYears" type="number" min="0" /></label><label>Age maximum<input name="ageMaxYears" type="number" min="0" /></label><label>Text range<input name="textRange" maxLength={200} /></label><label>Low value<input name="lowValue" type="number" step="any" /></label><label>High value<input name="highValue" type="number" step="any" /></label><label>Critical low<input name="criticalLow" type="number" step="any" /></label><label>Critical high<input name="criticalHigh" type="number" step="any" /></label><label className="span-2">Note<input name="note" maxLength={500} /></label></div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setRangeTest(null)}>Cancel</button><button className="button button-primary">Add range</button></div></form></Modal>}
  </>;
}

function PredictionsView({ user, onToast }: { user: User; onToast: (toast: ToastState) => void }) {
  const [page, setPage] = useState(1);
  const { data, state, error, refresh } = usePageData<Page<Prediction>>(`/predictions?page=${page}&pageSize=20`);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [requests, setRequests] = useState<LabRequest[]>([]);
  const [modal, setModal] = useState(false);
  const [result, setResult] = useState<Prediction | null>(null);

  async function openCreate() {
    try {
      const [patientPage, requestPage] = await Promise.all([
        apiFetch<Page<Patient>>('/patients?page=1&pageSize=100'),
        apiFetch<Page<LabRequest>>('/requests?page=1&pageSize=100'),
      ]);
      setPatients(patientPage.items.filter(patient => !patient.archivedAt));
      setRequests(requestPage.items);
      setModal(true);
    } catch (reason) { onToast({ message: reason instanceof Error ? reason.message : 'Could not load prediction form data.', tone: 'error' }); }
  }

  async function createPrediction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const requestId = String(form.get('requestId') ?? '');
    const body = {
      patientId: String(form.get('patientId')),
      ...(requestId ? { requestId } : {}),
      features: {
        age_years: Number(form.get('age_years')),
        sex: String(form.get('sex')),
        hemoglobin_g_dl: Number(form.get('hemoglobin_g_dl')),
        mcv_fl: Number(form.get('mcv_fl')),
        wbc_10e9_l: Number(form.get('wbc_10e9_l')),
        platelets_10e9_l: Number(form.get('platelets_10e9_l')),
      },
    };
    try {
      const created = await apiFetch<Prediction & { probabilities: Record<string, number> }>('/predictions', { method: 'POST', body });
      setResult(created); setModal(false); refresh();
    } catch (reason) { onToast({ message: reason instanceof Error ? reason.message : 'Prediction service is unavailable.', tone: 'error' }); }
  }

  return <>
    <PageHeader section="predictions" action={<button className="button button-primary" onClick={() => void openCreate()}>Run pattern analysis</button>} />
    <section className="prediction-banner"><span className="prediction-symbol">✳</span><div><strong>Educational prototype · Synthetic data only</strong><p>Not for diagnosis, screening, triage, treatment, or clinical decision-making. Outputs reproduce generated threshold patterns, not validated clinical interpretation.</p></div></section>
    <Panel title="Prediction history" subtitle={`${data?.total ?? 0} analyses`}>
      <PageState state={state} error={error} onRetry={refresh} />
      {data && <Table columns={['Patient record', 'Pattern', 'Model', 'Created', 'Notice']} empty={!data.items.length} emptyDescription="No analyses recorded. Results are saved only when explicitly requested.">
        {data.items.map(prediction => <tr key={prediction.id}><td><span className="table-primary">{prediction.patientId}</span><span className="table-secondary">Prediction record</span></td><td>{titleCase(prediction.predictedClass)}</td><td>{prediction.modelVersion}</td><td>{formatTimestamp(prediction.createdAt)}</td><td><span className="status-pill status-warn">Synthetic prototype</span></td></tr>)}
      </Table>}
      {data && <Pagination data={data} page={page} setPage={setPage} />}
    </Panel>
    {modal && <Modal title="CBC pattern analysis" subtitle="Enter six required CBC features. Inputs are saved with the prediction record." onClose={() => setModal(false)}><form className="modal-body" onSubmit={createPrediction}><div className="notice notice-warning">Prototype only: these synthetic categories are not medical findings.</div><div className="form-grid"><label className="span-2">Patient<select name="patientId" required defaultValue=""><option value="" disabled>Select patient</option>{patients.map(patient => <option key={patient.id} value={patient.id}>{patient.patientNumber} · {fullName(patient)}</option>)}</select></label><label className="span-2">Request{user.role === 'CLINICIAN' && <small>Required for clinician access and ownership scoping.</small>}<select name="requestId" required={user.role === 'CLINICIAN'} defaultValue=""><option value="">No linked request</option>{requests.map(request => <option key={request.id} value={request.id}>{request.requestNumber} · {request.patient.patientNumber}</option>)}</select></label><label>Age (years)<input name="age_years" type="number" required min="0" max="120" defaultValue="45" /></label><label>Sex<select name="sex" defaultValue="UNKNOWN"><option>UNKNOWN</option><option>FEMALE</option><option>MALE</option><option>OTHER</option></select></label><label>Hemoglobin (g/dL)<input name="hemoglobin_g_dl" type="number" required min="0" max="30" step="any" /></label><label>MCV (fL)<input name="mcv_fl" type="number" required min="0" max="200" step="any" /></label><label>WBC (10⁹/L)<input name="wbc_10e9_l" type="number" required min="0" max="500" step="any" /></label><label>Platelets (10⁹/L)<input name="platelets_10e9_l" type="number" required min="0" max="5000" step="any" /></label></div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setModal(false)}>Cancel</button><button className="button button-primary">Run analysis</button></div></form></Modal>}
    {result && <Modal title="Synthetic pattern result" subtitle={result.modelVersion} onClose={() => setResult(null)}><div className="modal-body"><div className="prediction-result"><span className="eyebrow">GENERATED PATTERN</span><h3>{titleCase(result.predictedClass)}</h3><span className="status-pill status-warn">Educational · Not clinical use</span></div>{result.probabilities && <div className="probability-list">{Object.entries(result.probabilities).map(([pattern, probability]) => <div key={pattern}><span>{titleCase(pattern)}</span><strong>{(probability * 100).toFixed(1)}%</strong><div className="bar-track"><div className="bar-fill" style={{ width: `${probability * 100}%` }} /></div></div>)}</div>}<div className="notice notice-warning">This result is generated from synthetic training data and is not clinically validated. Do not use it to make decisions about patient care.</div><div className="modal-actions"><button className="button button-primary" onClick={() => setResult(null)}>Close</button></div></div></Modal>}
  </>;
}

function UsersView({ user, onToast }: { user: User; onToast: (toast: ToastState) => void }) {
  const [page, setPage] = useState(1);
  const { data, state, error, refresh } = usePageData<Page<User & { lastLoginAt: string | null; createdAt: string }>>(`/users?page=${page}&pageSize=20`);
  const [createOpen, setCreateOpen] = useState(false);

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await apiFetch('/users', { method: 'POST', body: { email: String(form.get('email')), fullName: String(form.get('fullName')), role: String(form.get('role')), temporaryPassword: String(form.get('temporaryPassword')) } });
      setCreateOpen(false); refresh(); onToast({ message: 'User account created.' });
    } catch (reason) { onToast({ message: reason instanceof Error ? reason.message : 'Could not create user.', tone: 'error' }); }
  }

  async function updateUser(target: User, field: 'role' | 'active', value: string | boolean) {
    try {
      await apiFetch(`/users/${target.id}/${field}`, { method: 'PATCH', body: field === 'role' ? { role: value } : { isActive: value } });
      refresh(); onToast({ message: 'User access updated.' });
    } catch (reason) { onToast({ message: reason instanceof Error ? reason.message : 'Could not update user.', tone: 'error' }); }
  }

  return <>
    <PageHeader section="users" action={<button className="button button-primary" onClick={() => setCreateOpen(true)}>＋ Add user</button>} />
    <div className="notice notice-warning" style={{ marginBottom: 15 }}>Role or active-status changes affect access immediately. You cannot change your own role or deactivate your own account.</div>
    <Panel title="Workspace accounts" subtitle={`${data?.total ?? 0} accounts`}>
      <PageState state={state} error={error} onRetry={refresh} />
      {data && <Table columns={['User', 'Role', 'Status', 'Last sign in', 'Access controls']} empty={!data.items.length} emptyDescription="No users found.">
        {data.items.map(account => <tr key={account.id}><td><span className="table-primary">{account.fullName}{account.id === user.id ? ' (you)' : ''}</span><span className="table-secondary">{account.email}</span></td><td><select aria-label={`Role for ${account.fullName}`} value={account.role} disabled={account.id === user.id} onChange={event => void updateUser(account, 'role', event.target.value)}><option>ADMINISTRATOR</option><option>LABORATORY_SCIENTIST</option><option>CLINICIAN</option></select></td><td><Status value={account.isActive ? 'ACTIVE' : 'INACTIVE'} /></td><td>{formatTimestamp(account.lastLoginAt)}</td><td><button className={`button button-small ${account.isActive ? 'button-danger' : 'button-secondary'}`} disabled={account.id === user.id} onClick={() => void updateUser(account, 'active', !account.isActive)}>{account.isActive ? 'Deactivate' : 'Activate'}</button></td></tr>)}
      </Table>}
      {data && <Pagination data={data} page={page} setPage={setPage} />}
    </Panel>
    {createOpen && <Modal title="Provision workspace user" subtitle="The user should change this temporary password after signing in." onClose={() => setCreateOpen(false)}><form className="modal-body" onSubmit={createUser}><label>Full name<input name="fullName" required minLength={2} maxLength={120} /></label><label>Email address<input name="email" type="email" required maxLength={254} /></label><label>Role<select name="role"><option>CLINICIAN</option><option>LABORATORY_SCIENTIST</option><option>ADMINISTRATOR</option></select></label><label>Temporary password<input name="temporaryPassword" type="password" required minLength={12} maxLength={128} pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{12,128}" /><small>12–128 characters, with uppercase, lowercase, and a number.</small></label><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setCreateOpen(false)}>Cancel</button><button className="button button-primary">Create account</button></div></form></Modal>}
  </>;
}

function AuditLogsView({ onToast }: { onToast: (toast: ToastState) => void }) {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [outcome, setOutcome] = useState('');
  const [applied, setApplied] = useState({ action: '', outcome: '' });
  const query = useMemo(() => new URLSearchParams({ page: String(page), pageSize: '20', ...(applied.action ? { action: applied.action } : {}), ...(applied.outcome ? { outcome: applied.outcome } : {}) }).toString(), [page, applied]);
  const { data, state, error, refresh } = usePageData<Page<AuditEntry>>(`/audit-logs?${query}`);

  return <>
    <PageHeader section="audit-logs" />
    <div className="notice" style={{ marginBottom: 15 }}>Audit records are read-only. Sensitive values, credentials, and patient result values are not displayed here.</div>
    <Panel title="Audit events" subtitle={`${data?.total ?? 0} records`}>
      <form className="toolbar" onSubmit={event => { event.preventDefault(); setApplied({ action: action.trim(), outcome }); setPage(1); }}>
        <input className="toolbar-search" aria-label="Filter audit action" placeholder="Filter by action…" value={action} onChange={event => setAction(event.target.value)} />
        <select className="toolbar-select" aria-label="Filter audit outcome" value={outcome} onChange={event => setOutcome(event.target.value)}><option value="">All outcomes</option><option>SUCCESS</option><option>FAILURE</option><option>DENIED</option></select>
        <button className="button button-secondary button-small">Apply filters</button>
        <button type="button" className="button button-secondary button-small" onClick={() => { setAction(''); setOutcome(''); setApplied({ action: '', outcome: '' }); setPage(1); }}>Clear</button>
      </form>
      <PageState state={state} error={error} onRetry={refresh} />
      {data && <Table columns={['Time', 'Actor', 'Action', 'Resource', 'Outcome']} empty={!data.items.length} emptyDescription="No audit records match the selected filters.">
        {data.items.map(entry => <tr key={entry.id}><td>{formatTimestamp(entry.createdAt)}</td><td>{entry.actor?.fullName ?? 'System'}</td><td><span className="table-primary">{titleCase(entry.action)}</span></td><td>{entry.resourceType}<span className="table-secondary">{entry.resourceId ?? '—'}</span></td><td><Status value={entry.outcome} /></td></tr>)}
      </Table>}
      {data && <Pagination data={data} page={page} setPage={setPage} />}
    </Panel>
  </>;
}

export default function Workspace({ section }: Props) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const notify = useCallback((next: ToastState) => {
    setToast(next);
    window.setTimeout(() => setToast(current => current === next ? null : current), 4500);
  }, []);

  useEffect(() => { apiFetch<{ user: User }>('/auth/me').then(result => setUser(result.user)).catch(() => setUser(null)); }, []);

  let content: ReactNode;
  if (section === 'dashboard') content = <DashboardView />;
  else if (section === 'patients' && user) content = <PatientsView user={user} onToast={notify} />;
  else if (section === 'requests' && user) content = <RequestsView user={user} onToast={notify} />;
  else if (section === 'specimens' && user) content = <SpecimensView user={user} onToast={notify} />;
  else if (section === 'results' && user) content = <ResultsView user={user} onToast={notify} />;
  else if (section === 'reports' && user) content = <ReportsView user={user} onToast={notify} />;
  else if (section === 'catalogue' && user) content = <CatalogueView user={user} onToast={notify} />;
  else if (section === 'predictions' && user) content = <PredictionsView user={user} onToast={notify} />;
  else if (section === 'users' && user) content = <UsersView user={user} onToast={notify} />;
  else if (section === 'audit-logs') content = <AuditLogsView onToast={notify} />;
  else content = <PageHeader section={section} />;

  return <>{content}{toast && <div className={classNames('toast', toast.tone === 'error' && 'notice-error')} role="status">{toast.message}</div>}</>;
}
