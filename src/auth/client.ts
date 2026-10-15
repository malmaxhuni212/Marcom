'use client';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function readCookie(name: string): string | undefined {
  const prefix = `${name}=`;
  const entry = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
  if (!entry) return undefined;
  try {
    return decodeURIComponent(entry.slice(prefix.length));
  } catch {
    return undefined;
  }
}

export async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const headers = new Headers(init.headers);
  if (UNSAFE_METHODS.has(method)) {
    const token = readCookie('__Host-marcom_csrf') ?? readCookie('marcom_csrf');
    if (token) headers.set('X-CSRF-Token', token);
  }
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401 && window.location.pathname !== '/login') {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    globalThis.location.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  }
  return response;
}
