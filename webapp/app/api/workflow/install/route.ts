import { NextRequest, NextResponse } from 'next/server';
import { getOctokit }               from '@/lib/github';
import { readFileSync }             from 'fs';
import path                         from 'path';

// The template is committed alongside this app at the repo root.
const TEMPLATE_PATH = path.join(process.cwd(), '../android-repo-build.yml');

// POST /api/workflow/install — commit android-build.yml into a target repo
export async function POST(req: NextRequest) {
  const { owner, repo } = await req.json() as { owner: string; repo: string };

  if (!owner || !repo) {
    return NextResponse.json({ error: 'owner and repo are required' }, { status: 400 });
  }

  try {
    const octokit = await getOctokit();

    // Read the workflow template
    let content: string;
    try {
      content = readFileSync(TEMPLATE_PATH, 'utf8');
    } catch {
      return NextResponse.json({ error: 'Workflow template not found on server' }, { status: 500 });
    }

    // Check if file already exists (need its SHA to update)
    let sha: string | undefined;
    try {
      const existing = await octokit.repos.getContent({
        owner, repo, path: '.github/workflows/android-build.yml',
      });
      const data = existing.data as { sha: string };
      sha = data.sha;
    } catch { /* file doesn't exist yet — that's fine */ }

    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path:    '.github/workflows/android-build.yml',
      message: 'ci: add Android build workflow via Android CI Dashboard',
      content: Buffer.from(content).toString('base64'),
      ...(sha ? { sha } : {}),
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET /api/workflow/install?owner=&repo= — check workflow existence
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const owner = searchParams.get('owner') ?? '';
  const repo  = searchParams.get('repo')  ?? '';

  try {
    const octokit = await getOctokit();
    await octokit.repos.getContent({
      owner, repo, path: '.github/workflows/android-build.yml',
    });
    return NextResponse.json({ exists: true });
  } catch {
    return NextResponse.json({ exists: false });
  }
}
