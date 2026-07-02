import './globals.css';
import type { Metadata } from 'next';
import { Nav } from '@/components/Nav';
import { StatusBar } from '@/components/StatusBar';

export const metadata: Metadata = {
  title: 'condor.io — options trader',
  description: 'Iron condor analyzer with Monte Carlo simulation.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <Nav />
        <main className="flex-1 max-w-[1400px] w-full mx-auto px-6 py-6">{children}</main>
        <StatusBar />
      </body>
    </html>
  );
}