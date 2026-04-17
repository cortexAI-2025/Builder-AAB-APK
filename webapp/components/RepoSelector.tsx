'use client';

import { useState, useMemo } from 'react';

export interface Repo {
  id:             number;
  name:           string;
  full_name:      string;
  owner:          { login: string; avatar_url: string };
  private:        boolean;
  language:       string | null;
  topics:         string[];
  pushed_at:      string | null;
  likely_android: boolean;
}

interface Props {
  repos:    Repo[];
  selected: Repo | null;
  onSelect: (r: Repo) => void;
  loading:  boolean;
}

export default function RepoSelector({ repos, selected, onSelect, loading }: Props) {
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    const list = repos.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.full_name.toLowerCase().includes(q),
    );
    // Android repos first, then alphabetical
    list.sort((a, b) => {
      if (a.likely_android !== b.likely_android) return a.likely_android ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return showAll ? list : list.slice(0, 12);
  }, [repos, query, showAll]);

  const LANG_COLORS: Record<string, string> = {
    Kotlin: '#7F52FF', Java: '#B07219', Dart: '#00B4AB',
    Swift: '#FA7343', 'C++': '#F34B7D', Python: '#3572A5',
  };

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-12 skeleton rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={query}
        onChange={e => { setQuery(e.target.value); setShowAll(true); }}
        placeholder="Search repositories…"
        className="w-full bg-base border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
      />

      <div className="space-y-1 max-h-72 overflow-y-auto pr-0.5">
        {filtered.length === 0 && (
          <p className="text-sm text-gray-500 py-4 text-center">No repositories found.</p>
        )}
        {filtered.map(r => {
          const isSelected = selected?.id === r.id;
          return (
            <button
              key={r.id}
              onClick={() => onSelect(r)}
              className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all ${
                isSelected
                  ? 'bg-accent/10 border-accent/40 text-white'
                  : 'bg-transparent border-transparent hover:bg-white/[0.03] hover:border-border text-gray-300'
              }`}
            >
              {/* Language dot */}
              <span
                className="flex-shrink-0 w-2 h-2 rounded-full"
                style={{ background: LANG_COLORS[r.language ?? ''] ?? '#6b7280' }}
              />

              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium truncate">{r.name}</span>
                {r.private && (
                  <span className="text-xs text-gray-600">private</span>
                )}
              </span>

              {r.likely_android && (
                <span className="flex-shrink-0 text-xs px-1.5 py-0.5 bg-green-500/10 border border-green-500/20 text-green-400 rounded">
                  Android
                </span>
              )}
            </button>
          );
        })}
      </div>

      {repos.length > 12 && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full text-xs text-gray-500 hover:text-gray-300 py-1 transition-colors"
        >
          Show all {repos.length} repos ↓
        </button>
      )}
    </div>
  );
}
