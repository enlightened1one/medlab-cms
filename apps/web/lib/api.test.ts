import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('credentialed API client', () => {
  it('sends cookies, correlation IDs, and idempotency keys', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'request-1' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await apiFetch<{ id: string }>('/requests', {
      method: 'POST',
      idempotencyKey: 'stable-key',
      body: { patientId: 'patient-1' },
    });

    expect(result.id).toBe('request-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(options.credentials).toBe('include');
    expect(new Headers(options.headers).get('idempotency-key')).toBe('stable-key');
    expect(new Headers(options.headers).get('x-correlation-id')).toBeTruthy();
  });

  it('refreshes an expired authenticated session and retries the original request once', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Expired' } }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: 'user-1' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await apiFetch<{ items: unknown[] }>('/patients');
    expect(result.items).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toContain('/auth/refresh');
  });

  it('surfaces structured API failures without treating forbidden access as success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Access denied' } }),
      { status: 403 },
    )));

    await expect(apiFetch('/audit-logs')).rejects.toMatchObject({
      name: 'ApiError',
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    });
  });
});
