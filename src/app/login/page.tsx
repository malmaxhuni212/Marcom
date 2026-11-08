'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { setClientAccessMode } from '@/auth/client';

function safeReturnTo(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const response = await fetch('/api/v1/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        if (response.status === 429) {
          setError('Login is temporarily unavailable. Please wait and try again.');
        } else if (response.status >= 500) {
          setError('Sign-in failed due to a server or database error. Please verify database connectivity and try again.');
        } else if (response.status === 403) {
          setError('Sign-in request was rejected because the browser origin does not match APP_ORIGIN.');
        } else {
          setError('The username or password is incorrect.');
        }
        return;
      }
      setClientAccessMode('team');
      router.replace(safeReturnTo(searchParams.get('returnTo')));
      router.refresh();
    } catch {
      setError('Login could not be completed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#08080c] px-6 py-12 text-white">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-[#11131b] p-8 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-cyan-300">MARCOM</p>
          <Link
            href="/"
            className="text-xs font-semibold text-cyan-300 transition hover:text-cyan-200 hover:underline"
          >
            ← Continue as Guest
          </Link>
        </div>
        <h1 className="mt-4 text-3xl font-semibold">Team Login</h1>
        <p className="mt-2 text-sm leading-6 text-white/60">
          Sign in with authorised internal team credentials to access private team projects and leads.
        </p>

        <form className="mt-8 space-y-5" onSubmit={submit}>
          <div>
            <label className="mb-2 block text-sm font-medium" htmlFor="username">Username</label>
            <input
              id="username"
              name="username"
              autoComplete="username"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="w-full rounded-xl border border-white/15 bg-black/20 px-4 py-3 outline-none transition focus:border-cyan-300"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium" htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-white/15 bg-black/20 px-4 py-3 outline-none transition focus:border-cyan-300"
            />
          </div>
          {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-white px-4 py-3 font-semibold text-black transition hover:bg-cyan-100 disabled:cursor-wait disabled:opacity-60"
          >
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}
