import { cookies } from 'next/headers';
import Dashboard from '@/components/Dashboard';

interface GithubUser {
  login:      string;
  avatar_url: string;
  name:       string | null;
}

async function getUser(token: string): Promise<GithubUser | null> {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization:          `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      // revalidate every 60s; no caching of private user data beyond that
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function Home() {
  const cookieStore = await cookies();
  const token = cookieStore.get('gh_token')?.value;
  const user  = token ? await getUser(token) : null;

  return <Dashboard initialUser={user} />;
}
