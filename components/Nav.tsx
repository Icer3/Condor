'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { getDeviceId } from '@/lib/paperTrading';

const tabs = [
  { href: '/', label: 'home' },
  { href: '/trade', label: 'trade' },
  { href: '/compare', label: 'compare' },
  { href: '/learn', label: 'learn' },
  { href: '/portfolio', label: 'portfolio' },
  { href: '/tools', label: 'tools' },
  { href: '/calibration', label: 'calibration' },
  { href: '/auto-paper', label: 'auto' },
  { href: '/about', label: 'about' },
];

interface UserState {
  loggedIn: boolean;
  email?: string;
  deviceId: string; // anonymous fallback for legacy/anon usage
}

export function Nav() {
  const path = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<UserState>({ loggedIn: false, deviceId: '' });

  useEffect(() => {
    setUser(u => ({ ...u, deviceId: getDeviceId() }));
    // Try Supabase auth — if env isn't configured this throws and we just stay anon.
    (async () => {
      try {
        const supabase = getBrowserSupabase();
        const { data } = await supabase.auth.getUser();
        if (data.user) {
          setUser({ loggedIn: true, email: data.user.email ?? undefined, deviceId: getDeviceId() });
        }
        const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
          if (session?.user) {
            setUser({ loggedIn: true, email: session.user.email ?? undefined, deviceId: getDeviceId() });
          } else {
            setUser(u => ({ loggedIn: false, deviceId: getDeviceId() }));
          }
        });
        return () => sub.subscription.unsubscribe();
      } catch {
        // Supabase not configured — remain anonymous, use device id.
      }
    })();
  }, []);

  const signOut = async () => {
    try {
      const supabase = getBrowserSupabase();
      await supabase.auth.signOut();
    } catch { /* noop */ }
    router.push('/login');
    router.refresh();
  };

  return (
    <header className="border-b border-[var(--border)] bg-[var(--bg-2)]/80 backdrop-blur-md sticky top-0 z-20">
      <div className="max-w-[1500px] mx-auto px-6 py-3 flex items-center gap-4">
        <Link href="/" className="flex items-center gap-2 group">
          <img
            src="/brand/mark-32.png"
            alt="condor.io"
            width={28}
            height={28}
            className="w-7 h-7 rounded-[var(--radius-sm)] shadow-[0_0_16px_rgba(34,197,94,0.4)] transition group-hover:brightness-110"
          />
          <span className="text-[var(--fg)] group-hover:text-[var(--green)] transition font-semibold tracking-wide">condor.io</span>
        </Link>
        <nav className="flex items-center gap-1 ml-4">
          {tabs.map(t => {
            const active = path === t.href || (t.href !== '/' && path.startsWith(t.href));
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`px-4 py-1.5 rounded-full text-sm transition ${
                  active
                    ? 'bg-[var(--green-faint)] border border-[var(--green-dim)] text-[var(--green)] shadow-[0_0_12px_rgba(34,197,94,0.15)]'
                    : 'border border-transparent text-[var(--fg-dim)] hover:text-[var(--fg)] hover:bg-[var(--bg-3)]'
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex-1" />

        {user.loggedIn ? (
          <div className="flex items-center gap-2">
            <div
              className="text-[var(--green-dim)] text-xs hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--bg-3)] border border-[var(--border)]"
              title={user.email}
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--green)] opacity-60 animate-ping" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--green)]" />
              </span>
              <span className="font-bold tracking-wide">{user.email ?? 'signed in'}</span>
            </div>
            <button
              onClick={signOut}
              className="text-xs px-3 py-1.5 rounded-full border border-[var(--border)] text-[var(--fg-dim)] hover:text-[var(--red)] hover:border-[var(--red-border)] transition"
            >
              sign out
            </button>
          </div>
        ) : (
          <Link
            href="/login"
            className="text-xs px-3 py-1.5 rounded-full border border-[var(--green-dim)] bg-[var(--green-faint)]/40 text-[var(--green)] hover:bg-[var(--green-faint)] transition font-bold"
          >
            sign in
          </Link>
        )}
      </div>
    </header>
  );
}
