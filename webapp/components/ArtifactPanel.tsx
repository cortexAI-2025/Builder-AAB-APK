'use client';

import { useState } from 'react';

export interface Artifact {
  id:                   number;
  name:                 string;
  size_in_bytes:        number;
  archive_download_url: string;
  expired:              boolean;
}

interface Props {
  artifacts: Artifact[];
  owner:     string;
  repo:      string;
  runId:     number;
}

function fmtSize(bytes: number) {
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export default function ArtifactPanel({ artifacts, owner, repo, runId }: Props) {
  const [loading, setLoading] = useState<number | null>(null);
  const [errors,  setErrors]  = useState<Record<number, string>>({});

  const download = async (artifact: Artifact) => {
    if (artifact.expired) return;
    setLoading(artifact.id);
    setErrors(p => ({ ...p, [artifact.id]: '' }));

    try {
      const res = await fetch(`/api/artifacts/${runId}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ owner, repo, artifactId: artifact.id }),
      });
      const data = await res.json() as { downloadUrl?: string; error?: string };

      if (!res.ok || !data.downloadUrl) {
        setErrors(p => ({ ...p, [artifact.id]: data.error ?? 'Failed to get download URL' }));
        return;
      }

      // Open CDN URL in new tab — browser handles the .zip download
      window.open(data.downloadUrl, '_blank', 'noopener');
    } catch {
      setErrors(p => ({ ...p, [artifact.id]: 'Network error' }));
    } finally {
      setLoading(null);
    }
  };

  if (!artifacts.length) return null;

  const isApk = (name: string) => name.toLowerCase().includes('apk');

  return (
    <div className="space-y-2">
      {artifacts.map(a => (
        <div
          key={a.id}
          className="flex items-center gap-3 bg-base border border-border rounded-lg px-4 py-3"
        >
          <span className="text-2xl flex-shrink-0">{isApk(a.name) ? '📱' : '📦'}</span>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate">{a.name}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`text-xs px-1.5 py-0.5 rounded font-bold uppercase ${
                isApk(a.name)
                  ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                  : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
              }`}>
                {isApk(a.name) ? 'APK' : 'AAB'}
              </span>
              <span className="text-xs text-gray-500">{fmtSize(a.size_in_bytes)}</span>
              {a.expired && <span className="text-xs text-red-400">Expired</span>}
            </div>
            {errors[a.id] && (
              <p className="text-xs text-red-400 mt-1">{errors[a.id]}</p>
            )}
          </div>

          <button
            onClick={() => download(a)}
            disabled={a.expired || loading === a.id}
            className="flex-shrink-0 flex items-center gap-1.5 bg-accent hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold px-3 py-2 rounded-lg transition-opacity"
          >
            {loading === a.id ? (
              <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <span>↓</span>
            )}
            {loading === a.id ? 'Getting link…' : 'Download'}
          </button>
        </div>
      ))}

      <p className="text-xs text-gray-600 text-center pt-1">
        Artifacts are ZIP archives containing the APK or AAB file · expire after 7 days
      </p>
    </div>
  );
}
