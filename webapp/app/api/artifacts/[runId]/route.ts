import { NextRequest, NextResponse } from 'next/server';
import { getOctokit }               from '@/lib/github';
import type { Artifact }            from '@/lib/github';

// GET /api/artifacts/[runId]?owner=&repo=   — list artifacts
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

    const { data } = await octokit.actions.listWorkflowRunArtifacts({
      owner, repo, run_id: runId,
    });

    const artifacts: Artifact[] = data.artifacts.map(a => ({
      id:                   a.id,
      name:                 a.name,
      size_in_bytes:        a.size_in_bytes,
      archive_download_url: a.archive_download_url,
      expired:              a.expired,
      created_at:           a.created_at,
    }));

    return NextResponse.json({ artifacts });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET /api/artifacts/[runId]/download?owner=&repo=&artifactId=
// Returns a short-lived CDN download URL (GitHub redirects to an unauthenticated CDN URL)
export async function POST(
  req: NextRequest,
  _ctx: { params: Promise<{ runId: string }> },
) {
  const { owner, repo, artifactId } = await req.json() as {
    owner: string; repo: string; artifactId: number;
  };

  try {
    const token = req.cookies.get('gh_token')?.value;
    if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    // GitHub returns a 302 to a CDN URL; fetch with redirect:manual to capture it
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/actions/artifacts/${artifactId}/zip`;
    const res = await fetch(apiUrl, {
      headers: {
        Authorization:          `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      redirect: 'manual',
    });

    const downloadUrl = res.headers.get('location');
    if (!downloadUrl) {
      return NextResponse.json({ error: 'Could not get download URL' }, { status: 502 });
    }

    return NextResponse.json({ downloadUrl });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
