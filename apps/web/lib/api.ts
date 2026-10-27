const API_BASE = (
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  (process.env.NODE_ENV === 'production' ? '/api/v1' : 'http://localhost:4000/api/v1')
).replace(/\/+$/, '');

export type ApiErrorBody = {
  error?: { code?: string; message?: string; details?: unknown };
  message?: string;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error?.message ?? body.message ?? `Request failed (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.error?.code;
    this.details = body.error?.details;
  }
}

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
  idempotencyKey?: string;
};

const parseError = async (response: Response): Promise<ApiError> => {
  let body: ApiErrorBody = {};
  try {
    body = await response.json() as ApiErrorBody;
  } catch {
    body = {};
  }
  return new ApiError(response.status, body);
};

const refreshSession = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
    });
    return response.ok;
  } catch {
    return false;
  }
};

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, idempotencyKey, ...requestOptions } = options;
  const headers = new Headers(requestOptions.headers);
  if (body !== undefined) headers.set('content-type', 'application/json');
  headers.set('x-correlation-id', crypto.randomUUID());
  if (idempotencyKey) headers.set('idempotency-key', idempotencyKey);

  const execute = () => fetch(`${API_BASE}${path}`, {
    ...requestOptions,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let response = await execute();
  const noRefresh = ['/auth/login', '/auth/refresh', '/auth/logout', '/auth/forgot-password', '/auth/reset-password'];
  if (response.status === 401 && !noRefresh.includes(path)) {
    if (await refreshSession()) response = await execute();
  }
  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

export async function apiBlob(path: string): Promise<Blob> {
  const response = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  if (!response.ok) throw await parseError(response);
  return response.blob();
}

export const apiUrl = (path: string) => `${API_BASE}${path}`;
