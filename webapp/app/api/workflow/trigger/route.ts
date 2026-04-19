import { NextRequest, NextResponse } from 'next/server';
import { getOctokit, getLatestRun } from '@/lib/github';

interface TriggerBody {
  owner:        string;
  repo:         string;
  build_type:   'apk' | 'aab' | 'both';
  sign_release: boolean;
  ref?:         string;
}

// POST /api/workflow/trigger — fire workflow_dispatch
export async function POST(req: NextRequest) {
  const body = await req.json() as TriggerBody;
  const { owner, repo, build_type, sign_release, ref = 'main' } = body;

  if (!owner || !repo || !build_type) {
    return NextResponse.json({ error: 'owner, repo, build_type are required' }, { status: 400 });
  }

  try {
    const octokit = await getOctokit();

    // Snapshot the latest run ID *before* triggering so we can find the new run
    const prevRun = await getLatestRun(octokit, owner, repo);
    const prevId  = prevRun?.id ?? 0;

    // Trigger the workflow
    await octokit.actions.createWorkflowDispatch({
      owner,
      repo,
      workflow_id: 'mobixbuild.yml',
      ref,
      inputs: {
        build_type,
        sign_release: String(sign_release),
      },
    });

    // Poll up to 15 s for the new run to appear (GitHub queues asynchronously)
    let runId: number | null = null;
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const latest = await getLatestRun(octokit, owner, repo);
      if (latest && latest.id > prevId) {
        runId = latest.id;
        break;
      }
    }

    return NextResponse.json({ ok: true, runId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    // Common cause: workflow file missing or ref doesn't exist
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
