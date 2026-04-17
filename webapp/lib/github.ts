import { Octokit } from '@octokit/rest';
import { cookies }  from 'next/headers';

// ─── Factory ─────────────────────────────────────────────────────────────────
export async function getOctokit(token?: string): Promise<Octokit> {
  const cookieStore = await cookies();
  const auth = token ?? cookieStore.get('gh_token')?.value;
  if (!auth) throw new Error('Not authenticated');
  return new Octokit({ auth, userAgent: 'android-ci-dashboard/1.0' });
}

// ─── Types ───────────────────────────────────────────────────────────────────
export interface GithubUser {
  login:      string;
  avatar_url: string;
  name:       string | null;
}

export interface Repo {
  id:        number;
  name:      string;
  full_name: string;
  owner:     { login: string; avatar_url: string };
  private:   boolean;
  language:  string | null;
  topics:    string[];
  updated_at:string | null;
  pushed_at: string | null;
}

export interface WorkflowRun {
  id:          number;
  status:      string | null;   // queued | in_progress | completed
  conclusion:  string | null;   // success | failure | cancelled | skipped
  html_url:    string;
  created_at:  string;
  updated_at:  string;
  run_number:  number;
}

export interface Artifact {
  id:                   number;
  name:                 string;
  size_in_bytes:        number;
  archive_download_url: string;
  expired:              boolean;
  created_at:           string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** List repos the authenticated user can access. */
export async function listRepos(octokit: Octokit): Promise<Repo[]> {
  const { data } = await octokit.repos.listForAuthenticatedUser({
    sort:      'pushed',
    direction: 'desc',
    per_page:  100,
    type:      'all',
  });
  return data as Repo[];
}

/** Check whether a repo contains the Android build workflow. */
export async function workflowExists(
  octokit: Octokit,
  owner: string,
  repo:  string,
): Promise<boolean> {
  try {
    await octokit.repos.getContent({
      owner, repo,
      path: '.github/workflows/android-build.yml',
    });
    return true;
  } catch {
    return false;
  }
}

/** Get latest run for `android-build.yml` workflow. */
export async function getLatestRun(
  octokit: Octokit,
  owner: string,
  repo:  string,
): Promise<WorkflowRun | null> {
  try {
    const { data } = await octokit.actions.listWorkflowRuns({
      owner, repo,
      workflow_id: 'android-build.yml',
      per_page:    1,
    });
    return (data.workflow_runs[0] as WorkflowRun) ?? null;
  } catch {
    return null;
  }
}

/** Map GitHub's status/conclusion into a single app-level status string. */
export function normalizeRunStatus(run: WorkflowRun): string {
  if (run.status === 'queued')      return 'queued';
  if (run.status === 'in_progress') return 'in_progress';
  if (run.status === 'completed') {
    if (run.conclusion === 'success')   return 'success';
    if (run.conclusion === 'cancelled') return 'cancelled';
    return 'failure';
  }
  return 'queued';
}

/**
 * Estimate build progress (0-100) from elapsed time.
 * GitHub Actions doesn't expose per-step progress via API.
 */
export function estimateProgress(run: WorkflowRun, status: string): number {
  if (status === 'queued')    return 0;
  if (status === 'success' || status === 'failure' || status === 'cancelled') return 100;

  const elapsedMs  = Date.now() - new Date(run.created_at).getTime();
  const elapsedMin = elapsedMs / 60_000;
  // Assume avg build takes ~8 min; cap displayed progress at 90%
  return Math.min(90, Math.round((elapsedMin / 8) * 100));
}
