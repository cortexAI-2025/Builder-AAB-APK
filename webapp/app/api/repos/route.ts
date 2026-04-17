import { NextResponse }      from 'next/server';
import { getOctokit, listRepos } from '@/lib/github';

// GET /api/repos — list authenticated user's repos
export async function GET() {
  try {
    const octokit = await getOctokit();
    const repos   = await listRepos(octokit);

    // Annotate likely-Android repos so the UI can sort them to the top.
    // A full check would require reading repo contents (too many API calls),
    // so we use language + topics as a proxy.
    const ANDROID_LANGS   = new Set(['Kotlin', 'Java']);
    const ANDROID_TOPICS  = new Set(['android', 'android-app', 'kotlin', 'java']);

    const annotated = repos.map(r => ({
      ...r,
      likely_android:
        ANDROID_LANGS.has(r.language ?? '') ||
        (r.topics ?? []).some(t => ANDROID_TOPICS.has(t)),
    }));

    return NextResponse.json({ repos: annotated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
