'use client';

import { useState } from 'react';

interface Props {
  onLogin: (user: { login: string; avatar_url: string; name: string | null }) => void;
}

export default function TokenGate({ onLogin }: Props) {
  const [token,   setToken]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      onLogin(data.user);
    } catch {
      setError('Network error — is the server reachable?');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-accent/10 border border-accent/20 mb-4">
            <span className="text-2xl">🤖</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Android CI Dashboard</h1>
          <p className="text-gray-400 mt-2 text-sm">
            Connect your GitHub account to trigger APK &amp; AAB builds
          </p>
        </div>

        {/* Card */}
        <div className="bg-surface border border-border rounded-xl p-6">
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">
                GitHub Personal Access Token
              </label>
              <input
                type="password"
                value={token}
                onChange={e => setToken(e.target.value)}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                className="w-full bg-base border border-border rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent font-mono"
                autoComplete="off"
                spellCheck={false}
                required
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-sm text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !token}
              className="w-full bg-accent hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg text-sm transition-opacity"
            >
              {loading ? 'Verifying…' : 'Connect'}
            </button>
          </form>

          {/* Required scopes */}
          <div className="mt-5 pt-5 border-t border-border">
            <p className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wide">Required token scopes</p>
            <div className="flex flex-wrap gap-1.5">
              {['repo', 'workflow', 'read:org'].map(s => (
                <span key={s} className="px-2 py-0.5 bg-base border border-border rounded text-xs font-mono text-gray-400">{s}</span>
              ))}
            </div>
            <p className="text-xs text-gray-600 mt-3">
              Token is stored in an httpOnly cookie and never sent to the client.
              {' '}<a href="https://github.com/settings/tokens/new" target="_blank" rel="noopener noreferrer" className="text-accent2 hover:underline">Create one →</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
