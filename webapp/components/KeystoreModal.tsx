'use client';

import { useState, useRef } from 'react';

interface Props {
  owner:    string;
  repo:     string;
  onSaved:  () => void;
  onClose:  () => void;
}

export default function KeystoreModal({ owner, repo, onSaved, onClose }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file,       setFile]       = useState<File | null>(null);
  const [alias,      setAlias]      = useState('');
  const [storePass,  setStorePass]  = useState('');
  const [keyPass,    setKeyPass]    = useState('');
  const [samePass,   setSamePass]   = useState(true);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');
  const [success,    setSuccess]    = useState(false);

  const handleFile = (f: File | null | undefined) => {
    if (!f) return;
    if (!f.name.match(/\.(jks|keystore|p12)$/i)) {
      setError('File must be a .jks, .keystore or .p12 file');
      return;
    }
    setFile(f);
    setError('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !alias || !storePass) return;
    setError('');
    setLoading(true);

    try {
      // Read file as base64
      const keystoreBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = (reader.result as string).split(',')[1];
          resolve(result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const res = await fetch('/api/secrets', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          owner,
          repo,
          keystoreBase64,
          keystoreAlias: alias,
          keystorePass:  storePass,
          keyPass:       samePass ? storePass : keyPass,
        }),
      });

      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) { setError(data.error ?? 'Failed to save secrets'); return; }

      setSuccess(true);
      setTimeout(() => { onSaved(); onClose(); }, 1500);
    } catch {
      setError('Network error while saving secrets');
    } finally {
      setLoading(false);
    }
  };

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md bg-surface border border-border rounded-xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="font-semibold text-white">Configure Signing Keystore</h2>
            <p className="text-xs text-gray-500 mt-0.5">{owner}/{repo}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none p-1">✕</button>
        </div>

        {/* Body */}
        <form onSubmit={submit} className="p-5 space-y-4">
          {success ? (
            <div className="py-8 text-center">
              <span className="text-4xl">✅</span>
              <p className="text-green-400 font-semibold mt-3">Secrets saved to GitHub!</p>
              <p className="text-xs text-gray-500 mt-1">4 repo secrets created / updated.</p>
            </div>
          ) : (
            <>
              {/* File drop */}
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                  Keystore file (.jks / .keystore)
                </label>
                <div
                  className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                    file ? 'border-accent/40 bg-accent/5' : 'border-border hover:border-gray-500'
                  }`}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
                >
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".jks,.keystore,.p12"
                    className="hidden"
                    onChange={e => handleFile(e.target.files?.[0])}
                  />
                  {file ? (
                    <div className="flex items-center justify-center gap-2 text-accent2">
                      <span>🔑</span>
                      <span className="text-sm font-medium">{file.name}</span>
                      <span className="text-xs text-gray-500">({(file.size / 1024).toFixed(1)} KB)</span>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">Drop keystore file here or click to browse</p>
                  )}
                </div>
              </div>

              {/* Key alias */}
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Key alias</label>
                <input
                  value={alias}
                  onChange={e => setAlias(e.target.value)}
                  placeholder="my-key-alias"
                  className="w-full bg-base border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent font-mono"
                  required
                />
              </div>

              {/* Store password */}
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Keystore password</label>
                <input
                  type="password"
                  value={storePass}
                  onChange={e => setStorePass(e.target.value)}
                  className="w-full bg-base border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                  required
                />
              </div>

              {/* Same password toggle */}
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={samePass}
                  onChange={e => setSamePass(e.target.checked)}
                  className="w-4 h-4 rounded accent-indigo-500"
                />
                <span className="text-sm text-gray-400">Key password same as keystore password</span>
              </label>

              {!samePass && (
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Key password</label>
                  <input
                    type="password"
                    value={keyPass}
                    onChange={e => setKeyPass(e.target.value)}
                    className="w-full bg-base border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-accent"
                    required
                  />
                </div>
              )}

              {/* Security note */}
              <div className="text-xs text-gray-600 bg-base border border-border rounded-lg px-3 py-2 space-y-0.5">
                <p>🔒 <strong className="text-gray-500">Encrypted with repo public key</strong> (libsodium sealed_box)</p>
                <p>Stored as GitHub Actions secrets — never visible again after saving.</p>
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-sm text-red-400">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !file || !alias || !storePass}
                className="w-full bg-accent hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg text-sm transition-opacity"
              >
                {loading ? 'Encrypting & saving…' : '🔒 Save to GitHub Secrets'}
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
