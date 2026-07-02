'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { Panel, Tag } from '@/components/Panels';

type Mode = 'signin' | 'signup' | 'magic';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // If already signed in, jump home (or to the `next` destination if present).
  useEffect(() => {
    (async () => {
      try {
        const supabase = getBrowserSupabase();
        const { data } = await supabase.auth.getUser();
        if (data.user) {
          const next = sanitizeNext(typeof window !== 'undefined' ? new URL(window.location.href).searchParams.get('next') : null);
          router.replace(next ?? '/');
        }
      } catch {
        // Supabase not configured — fall through to login form.
      }
    })();
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    try {
      const supabase = getBrowserSupabase();
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        const next = sanitizeNext(new URL(window.location.href).searchParams.get('next'));
        router.push(next ?? '/');
      } else if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + '/auth/callback' },
        });
        if (error) throw error;
        setMsg({ kind: 'ok', text: 'check your inbox to confirm your email' });
      } else if (mode === 'magic') {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: window.location.origin + '/auth/callback' },
        });
        if (error) throw error;
        setMsg({ kind: 'ok', text: 'magic link sent — check your inbox' });
      }
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message ?? 'something went wrong' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-[480px] mx-auto py-8">
      <Panel title="~login"
        right={
          <Tag color="dim">supabase auth</Tag>
        }
      >
        <div className="text-[11px] italic text-[var(--fg-dim)] leading-relaxed mb-3 border-l-2 border-[var(--green-dim)] pl-2">
          sign in once and your paper portfolio, calibration history, and watchlists follow you across
          devices. no broker integration, no payment info — just a way to keep your work private to you.
        </div>

        <div className="flex gap-1 mb-4">
          {(['signin', 'signup', 'magic'] as Mode[]).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setMsg(null); }}
              className={`flex-1 py-1.5 text-xs font-bold rounded-[var(--radius-sm)] transition border ${
                mode === m
                  ? 'bg-[var(--green-faint)] border-[var(--green-dim)] text-[var(--green)]'
                  : 'border-[var(--border)] text-[var(--fg-dim)] hover:text-[var(--fg)]'
              }`}
            >
              {m === 'signin' ? 'sign in' : m === 'signup' ? 'sign up' : 'magic link'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <div className="text-[9px] uppercase tracking-wider text-[var(--fg-faint)] mb-1 font-medium">email</div>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full px-3 py-2 text-sm"
              placeholder="you@example.com"
            />
          </label>
          {mode !== 'magic' && (
            <label className="block">
              <div className="text-[9px] uppercase tracking-wider text-[var(--fg-faint)] mb-1 font-medium">
                password{mode === 'signup' ? ' (min 6 chars)' : ''}
              </div>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={mode === 'signup' ? 6 : 1}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                className="w-full px-3 py-2 text-sm"
                placeholder="••••••••"
              />
            </label>
          )}

          <button type="submit" disabled={loading || !email} className="btn-primary w-full py-2 text-sm font-bold">
            {loading ? '⟳' : mode === 'signin' ? '▶ sign in' : mode === 'signup' ? '▶ create account' : '▶ send magic link'}
          </button>

          {msg && (
            <div className={`text-xs p-2 rounded-[var(--radius-sm)] border ${
              msg.kind === 'ok'
                ? 'border-[var(--green-dim)] bg-[var(--green-faint)]/40 text-[var(--green)]'
                : 'border-[var(--red-border)] bg-[var(--red-faint)]/40 text-[var(--red)]'
            }`}>
              {msg.kind === 'ok' ? '✓' : '!'} {msg.text}
            </div>
          )}
        </form>

        <div className="mt-4 pt-3 border-t border-[var(--border)] flex justify-between items-center text-[10px] text-[var(--fg-faint)]">
          <span>no spam, no marketing</span>
          <Link href="/" className="text-[var(--green)] hover:underline">← back to app</Link>
        </div>
      </Panel>

      <Panel title="~env-check">
        <EnvCheck />
      </Panel>
    </div>
  );
}

/** Sanitize the ?next= query param: only allow same-origin app paths to
 *  prevent open-redirect attacks via /login?next=https://evil.com. */
function sanitizeNext(next: string | null): string | null {
  if (!next) return null;
  if (!next.startsWith('/')) return null;
  if (next.startsWith('//')) return null;
  if (next.startsWith('/login') || next.startsWith('/auth')) return null;
  return next;
}

function EnvCheck() {
  const [state, setState] = useState<'pending' | 'ok' | 'unset'>('pending');
  useEffect(() => {
    const urlOk = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
    const keyOk = !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    setState(urlOk && keyOk ? 'ok' : 'unset');
  }, []);
  if (state === 'pending') return null;
  if (state === 'unset') {
    return (
      <div className="text-xs text-[var(--yellow)] leading-snug">
        ⚠ NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set in this build.
        copy <code className="text-[var(--fg)]">.env.local.example</code> to <code className="text-[var(--fg)]">.env.local</code> and fill in your project creds.
      </div>
    );
  }
  return (
    <div className="text-xs text-[var(--green-dim)] leading-snug">
      ✓ NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY detected.
    </div>
  );
}
