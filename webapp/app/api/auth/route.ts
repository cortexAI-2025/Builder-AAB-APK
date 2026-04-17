import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

// ── POST /api/auth — save token in httpOnly cookie ────────────────────────────
export async function POST(req: NextRequest) {
  const { token } = await req.json() as { token: string };

  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: 'Token is required' }, { status: 400 });
  }

  // Validate against GitHub API before storing
  const ghRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization:          `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!ghRes.ok) {
    return NextResponse.json(
      { error: 'Invalid GitHub token — check scopes (repo + workflow)' },
      { status: 401 },
    );
  }

  const user = await ghRes.json() as { login: string; avatar_url: string; name: string | null };

  // httpOnly + SameSite=Lax keeps the token off the client side
  const res = NextResponse.json({ user: { login: user.login, avatar_url: user.avatar_url, name: user.name } });
  res.cookies.set('gh_token', token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   60 * 60 * 8,   // 8-hour session
    path:     '/',
  });

  return res;
}

// ── DELETE /api/auth — logout ─────────────────────────────────────────────────
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete('gh_token');
  return res;
}

// ── GET /api/auth — current session ─────────────────────────────────────────
export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get('gh_token')?.value;
  if (!token) return NextResponse.json({ user: null });

  const ghRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization:          `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    next: { revalidate: 60 },
  });

  if (!ghRes.ok) {
    const res = NextResponse.json({ user: null });
    res.cookies.delete('gh_token');
    return res;
  }

  const user = await ghRes.json() as { login: string; avatar_url: string; name: string | null };
  return NextResponse.json({ user: { login: user.login, avatar_url: user.avatar_url, name: user.name } });
}
