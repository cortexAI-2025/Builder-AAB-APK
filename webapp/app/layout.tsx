import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title:       'Android CI Dashboard',
  description: 'Trigger, monitor and download Android APK/AAB builds via GitHub Actions',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-base antialiased">{children}</body>
    </html>
  );
}
