'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

function bootstrapError(status: number): string {
  if (status === 404) return 'Bootstrap is disabled or the setup token is incorrect.';
  if (status === 409) return 'Shared pilot access has already been configured.';
  if (status === 503) return 'The database foundation is not ready. Check the latest deployment migration.';
  return 'Shared pilot access could not be configured. Please try again.';
}

export default function BootstrapPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('marcom-pilot');
  const [displayName, setDisplayName] = useState('MARCOM Shared Pilot');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (password !== confirmation) {
      setError('The password confirmation does not match.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/internal/v1/auth/bootstrap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Marcom-Bootstrap-Token': token,
        },
        body: JSON.stringify({ username, displayName, password }),
      });
      if (!response.ok) {
        setError(bootstrapError(response.status));
        return;
      }

      setToken('');
      setPassword('');
      setConfirmation('');
      setComplete(true);
    } catch {
      setError('The setup request could not reach the server. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#08080c] px-6 py-12 text-white">
      <section className="w-full max-w-lg rounded-3xl border border-white/10 bg-[#11131b] p-8 shadow-2xl">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-cyan-300">MARCOM</p>
        <h1 className="mt-4 text-3xl font-semibold">Initial team access</h1>
        <p className="mt-2 text-sm leading-6 text-white/60">
          Create the first shared pilot credential. This operation works only once and requires the temporary setup token stored in Netlify.
        </p>

        {complete ? (
          <div className="mt-8 space-y-5">
            <p role="status" className="rounded-xl border border-emerald-300/30 bg-emerald-300/10 p-4 text-sm text-emerald-100">
              Shared pilot access is configured. Remove AUTH_BOOTSTRAP_SECRET from Netlify, redeploy, then sign in.
            </p>
            <button
              type="button"
              onClick={() => router.replace('/login')}
              className="w-full rounded-xl bg-white px-4 py-3 font-semibold text-black transition hover:bg-cyan-100"
            >
              Continue to login
            </button>
          </div>
        ) : (
          <form className="mt-8 space-y-5" onSubmit={submit}>
            <div>
              <label className="mb-2 block text-sm font-medium" htmlFor="bootstrap-token">Temporary setup token</label>
              <input
                id="bootstrap-token"
                name="bootstrap-token"
                type="password"
                autoComplete="off"
                required
                value={token}
                onChange={(event) => setToken(event.target.value)}
                className="w-full rounded-xl border border-white/15 bg-black/20 px-4 py-3 outline-none transition focus:border-cyan-300"
              />
            </div>
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
              <label className="mb-2 block text-sm font-medium" htmlFor="display-name">Display name</label>
              <input
                id="display-name"
                name="display-name"
                required
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                className="w-full rounded-xl border border-white/15 bg-black/20 px-4 py-3 outline-none transition focus:border-cyan-300"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium" htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={16}
                maxLength={128}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-xl border border-white/15 bg-black/20 px-4 py-3 outline-none transition focus:border-cyan-300"
              />
              <p className="mt-2 text-xs text-white/45">Use between 16 and 128 characters.</p>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium" htmlFor="confirmation">Confirm password</label>
              <input
                id="confirmation"
                name="confirmation"
                type="password"
                autoComplete="new-password"
                minLength={16}
                maxLength={128}
                required
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                className="w-full rounded-xl border border-white/15 bg-black/20 px-4 py-3 outline-none transition focus:border-cyan-300"
              />
            </div>
            {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-white px-4 py-3 font-semibold text-black transition hover:bg-cyan-100 disabled:cursor-wait disabled:opacity-60"
            >
              {submitting ? 'Creating access...' : 'Create shared access'}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
