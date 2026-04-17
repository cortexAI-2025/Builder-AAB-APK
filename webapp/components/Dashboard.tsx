'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Image from 'next/image';
import TokenGate                    from './TokenGate';
import RepoSelector, { type Repo } from './RepoSelector';
import BuildPanel                   from './BuildPanel';
import ProgressTracker              from './ProgressTracker';
import ArtifactPanel, { type Artifact } from './ArtifactPanel';
import KeystoreModal                from './KeystoreModal';

// ─── Types ───────────────────────────────────────────────────────────────────
interface User { login: string; avatar_url: string; name: string | null; }
type BuildType   = 'apk' | 'aab' | 'both';
type BuildStatus = 'idle' | 'triggering' | 'queued' | 'in_progress' | 'success' | 'failure' | 'cancelled';

interface RunInfo {
  runId:       number;
  status:      BuildStatus;
  progress:    number;
  currentStep: string;
  html_url:    string;
}

interface HistoryEntry {
  runId:    number;
  repoName: string;
  type:     BuildType;
  status:   BuildStatus;
  ts:       number;
}

// ─── Dashboard ───────────────────────────────────────────────────────────────
export default function Dashboard({ initialUser }: { initialUser: User | null }) {
  // Auth
  const [user,    setUser]    = useState<User | null>(initialUser);

  // Repos
  const [repos,        setRepos]        = useState<Repo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);

  // Workflow
  const [workflowExists,     setWorkflowExists]     = useState<boolean | null>(null);
  const [installingWorkflow, setInstallingWorkflow]  = useState(false);

  // Build config
  const [buildType,   setBuildType]   = useState<BuildType>('apk');
  const [signRelease, setSignRelease] = useState(false);
  const [keystoreOk,  setKeystoreOk]  = useState(false);

  // Build runtime
  const [buildStatus, setBuildStatus] = useState<BuildStatus>('idle');
  const [run,         setRun]         = useState<RunInfo | null>(null);
  const [artifacts,   setArtifacts]   = useState<Artifact[]>([]);
  const [triggering,  setTriggering]  = useState(false);
  const [error,       setError]       = useState('');

  // UI
  const [showKeystore, setShowKeystore] = useState(false);
  const [history,      setHistory]      = useState<HistoryEntry[]>([]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load history from localStorage ─────────────────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem('android_ci_history');
      if (raw) setHistory(JSON.parse(raw) as HistoryEntry[]);
    } catch { /* ignore */ }
  }, []);

  const pushHistory = (entry: HistoryEntry) => {
    setHistory(prev => {
      const next = [entry, ...prev].slice(0, 20);
      try { localStorage.setItem('android_ci_history', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  // ── Load repos when user logs in ────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    setReposLoading(true);
    fetch('/api/repos')
      .then(r => r.json())
      .then(d => setRepos(d.repos ?? []))
      .catch(() => setRepos([]))
      .finally(() => setReposLoading(false));
  }, [user]);

  // ── Check workflow when repo is selected ────────────────────────────────────
  const checkWorkflow = useCallback(async (repo: Repo) => {
    setWorkflowExists(null);
    const res = await fetch(`/api/workflow/install?owner=${repo.owner.login}&repo=${repo.name}`);
    const d = await res.json() as { exists: boolean };
    setWorkflowExists(d.exists);
  }, []);

  const selectRepo = (r: Repo) => {
    setSelectedRepo(r);
    setBuildStatus('idle');
    setRun(null);
    setArtifacts([]);
    setError('');
    checkWorkflow(r);
  };

  // ── Install workflow ────────────────────────────────────────────────────────
  const installWorkflow = async () => {
    if (!selectedRepo) return;
    setInstallingWorkflow(true);
    try {
      const res = await fetch('/api/workflow/install', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ owner: selectedRepo.owner.login, repo: selectedRepo.name }),
      });
      if (res.ok) setWorkflowExists(true);
      else {
        const d = await res.json() as { error: string };
        setError(d.error);
      }
    } finally {
      setInstallingWorkflow(false);
    }
  };

  // ── Polling ─────────────────────────────────────────────────────────────────
  const stopPoll = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const startPoll = (runId: number, repo: Repo) => {
    stopPoll();
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/workflow/run/${runId}?owner=${repo.owner.login}&repo=${repo.name}`);
        const d = await res.json() as {
          status: BuildStatus; progress: number; currentStep: string; html_url: string;
        };

        setBuildStatus(d.status);
        setRun(r => r ? { ...r, status: d.status, progress: d.progress, currentStep: d.currentStep } : null);

        const terminal = ['success', 'failure', 'cancelled'];
        if (terminal.includes(d.status)) {
          stopPoll();

          // Save to history
          pushHistory({ runId, repoName: repo.name, type: buildType, status: d.status, ts: Date.now() });

          // Fetch artifacts on success
          if (d.status === 'success') {
            const artRes = await fetch(`/api/artifacts/${runId}?owner=${repo.owner.login}&repo=${repo.name}`);
            const artData = await artRes.json() as { artifacts: Artifact[] };
            setArtifacts(artData.artifacts ?? []);
          }
        }
      } catch { /* network hiccup — keep polling */ }
    }, 3500);
  };

  useEffect(() => () => stopPoll(), []);

  // ── Trigger build ───────────────────────────────────────────────────────────
  const triggerBuild = async () => {
    if (!selectedRepo) return;
    setError('');
    setTriggering(true);
    setBuildStatus('triggering');
    setArtifacts([]);

    try {
      const res = await fetch('/api/workflow/trigger', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          owner:        selectedRepo.owner.login,
          repo:         selectedRepo.name,
          build_type:   buildType,
          sign_release: signRelease,
        }),
      });
      const d = await res.json() as { ok?: boolean; runId?: number; error?: string };

      if (!res.ok || !d.runId) {
        setError(d.error ?? 'Failed to trigger workflow. Check the branch name and workflow file.');
        setBuildStatus('idle');
        return;
      }

      const newRun: RunInfo = {
        runId: d.runId, status: 'queued', progress: 0, currentStep: '', html_url: '',
      };
      setRun(newRun);
      setBuildStatus('queued');
      startPoll(d.runId, selectedRepo);
    } finally {
      setTriggering(false);
    }
  };

  // ── Logout ──────────────────────────────────────────────────────────────────
  const logout = async () => {
    await fetch('/api/auth', { method: 'DELETE' });
    setUser(null);
    setRepos([]);
    setSelectedRepo(null);
    setBuildStatus('idle');
    stopPoll();
  };

  // ─────────────────────────────────────────────────────────────────────────────
  if (!user) return <TokenGate onLogin={setUser} />;

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Header ── */}
      <header className="border-b border-border bg-surface/50 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🤖</span>
            <span className="font-bold text-white text-sm">Android CI Dashboard</span>
          </div>
          <div className="flex items-center gap-3">
            {selectedRepo && (
              <span className="hidden sm:flex items-center gap-1.5 text-xs text-gray-400 bg-base border border-border px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                {selectedRepo.full_name}
              </span>
            )}
            <div className="flex items-center gap-2">
              <Image
                src={user.avatar_url}
                alt={user.login}
                width={28}
                height={28}
                className="rounded-full"
              />
              <span className="text-sm text-gray-300 hidden sm:block">{user.login}</span>
            </div>
            <button onClick={logout} className="text-xs text-gray-500 hover:text-white border border-border hover:border-gray-500 px-2.5 py-1 rounded-lg transition-colors">
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* ── Main layout ── */}
      <div className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">

        {/* ── Left: repo + build config ── */}
        <aside className="space-y-4">

          {/* Repo selector */}
          <div className="bg-surface border border-border rounded-xl p-4">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
              1 · Repository
            </h2>
            <RepoSelector
              repos={repos}
              selected={selectedRepo}
              onSelect={selectRepo}
              loading={reposLoading}
            />
          </div>

          {/* Build config */}
          {selectedRepo && (
            <div className="bg-surface border border-border rounded-xl p-4">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                2 · Build
              </h2>
              <BuildPanel
                buildType={buildType}
                signRelease={signRelease}
                keystoreConfigured={keystoreOk}
                workflowExists={workflowExists}
                installingWorkflow={installingWorkflow}
                triggering={triggering}
                canBuild={!!selectedRepo && workflowExists === true}
                onBuildTypeChange={setBuildType}
                onSignChange={setSignRelease}
                onInstallWorkflow={installWorkflow}
                onTrigger={triggerBuild}
                onKeystoreClick={() => setShowKeystore(true)}
              />
            </div>
          )}
        </aside>

        {/* ── Right: status + artifacts + history ── */}
        <main className="space-y-4">

          {/* Welcome / empty state */}
          {!selectedRepo && (
            <div className="bg-surface border border-border rounded-xl flex flex-col items-center justify-center py-24 text-center px-6">
              <div className="w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center text-3xl mb-4">📱</div>
              <h2 className="text-lg font-semibold text-white mb-2">Select a repository</h2>
              <p className="text-gray-500 text-sm max-w-xs">
                Choose an Android repository from the left panel to start a build via GitHub Actions.
              </p>
            </div>
          )}

          {/* Progress card */}
          {selectedRepo && (
            <div className="bg-surface border border-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Build status</h2>
                {run?.html_url && (
                  <a href={run.html_url} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-gray-500 hover:text-accent2 transition-colors">
                    GitHub Actions →
                  </a>
                )}
              </div>

              {error && (
                <div className="mb-4 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-sm text-red-400">
                  {error}
                </div>
              )}

              <ProgressTracker
                status={buildStatus}
                progress={run?.progress ?? 0}
                currentStep={run?.currentStep ?? ''}
                runUrl={run?.html_url ?? ''}
                runId={run?.runId ?? null}
              />
            </div>
          )}

          {/* Artifacts */}
          {artifacts.length > 0 && selectedRepo && run && (
            <div className="bg-surface border border-border rounded-xl p-5">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                Artifacts · Run #{run.runId}
              </h2>
              <ArtifactPanel
                artifacts={artifacts}
                owner={selectedRepo.owner.login}
                repo={selectedRepo.name}
                runId={run.runId}
              />
            </div>
          )}

          {/* Build history */}
          {history.length > 0 && (
            <div className="bg-surface border border-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Recent builds</h2>
                <button
                  onClick={() => { setHistory([]); localStorage.removeItem('android_ci_history'); }}
                  className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
                >
                  Clear
                </button>
              </div>
              <div className="space-y-1.5">
                {history.map((h, i) => {
                  const STATUS_ICON: Record<string, string> = { success: '✓', failure: '✕', cancelled: '—', queued: '○', in_progress: '●', triggering: '●', idle: '○' };
                  const STATUS_CLR: Record<string, string>  = { success: 'text-green-400', failure: 'text-red-400', cancelled: 'text-gray-500', queued: 'text-blue-400', in_progress: 'text-yellow-400', triggering: 'text-blue-400', idle: 'text-gray-600' };
                  const ago = (() => {
                    const diff = Date.now() - h.ts;
                    const m = Math.floor(diff / 60_000);
                    if (m < 1)  return 'just now';
                    if (m < 60) return `${m}m ago`;
                    const hr = Math.floor(m / 60);
                    if (hr < 24) return `${hr}h ago`;
                    return `${Math.floor(hr / 24)}d ago`;
                  })();
                  return (
                    <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-base/50 transition-colors">
                      <span className={`text-sm font-bold w-4 text-center ${STATUS_CLR[h.status]}`}>{STATUS_ICON[h.status]}</span>
                      <span className="flex-1 text-sm text-gray-300 truncate">{h.repoName}</span>
                      <span className="text-xs px-1.5 py-0.5 bg-base border border-border text-gray-500 rounded uppercase font-mono">{h.type}</span>
                      <span className="text-xs text-gray-600 w-16 text-right">{ago}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ── Keystore modal ── */}
      {showKeystore && selectedRepo && (
        <KeystoreModal
          owner={selectedRepo.owner.login}
          repo={selectedRepo.name}
          onSaved={() => setKeystoreOk(true)}
          onClose={() => setShowKeystore(false)}
        />
      )}
    </div>
  );
}
