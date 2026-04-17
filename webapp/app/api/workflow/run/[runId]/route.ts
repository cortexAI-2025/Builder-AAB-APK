import { NextRequest, NextResponse }               from 'next/server';
import { getOctokit, normalizeRunStatus, estimateProgress } from '@/lib/github';
import type { WorkflowRun }                        from '@/lib/github';

// GET /api/workflow/run/[runId]?owner=&repo=
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { searchParams } = new URL(req.url);
  const owner = searchParams.get('owner') ?? '';
  const repo  = searchParams.get('repo')  ?? '';
  const { runId: runIdStr } = await params;
  const runId = parseInt(runIdStr, 10);

  if (!owner || !repo || isNaN(runId)) {
    return NextResponse.json({ error: 'owner, repo, runId required' }, { status: 400 });
  }

  try {
    const octokit = await getOctokit();

    const { data: run } = await octokit.actions.getWorkflowRun({
      owner, repo, run_id: runId,
    });

    const status   = normalizeRunStatus(run as WorkflowRun);
    const progress = estimateProgress(run as WorkflowRun, status);

    // Fetch jobs to get a human-readable current step name
    let currentStep = '';
    if (status === 'in_progress') {
      try {
        const { data: jobs } = await octokit.actions.listJobsForWorkflowRun({
          owner, repo, run_id: runId,
        });
        const activeJob = jobs.jobs.find(j => j.status === 'in_progress');
        if (activeJob) {
          const activeStep = activeJob.steps?.find(s => s.status === 'in_progress');
          currentStep = activeStep?.name ?? activeJob.name;
        }
      } catch { /* non-critical */ }
    }

    return NextResponse.json({
      runId,
      status,
      progress,
      currentStep,
      conclusion: run.conclusion,
      html_url:   run.html_url,
      created_at: run.created_at,
      updated_at: run.updated_at,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
