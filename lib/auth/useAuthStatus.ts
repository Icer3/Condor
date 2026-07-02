// useAuthStatus — tiny client hook that reports whether the current viewer is
// signed in via Supabase. Returns 'unknown' during the initial auth probe so we
// don't flash the wrong CTA state before Supabase has been called.
//
//   const { status } = useAuthStatus();
//   status === 'anon' → prompt to sign in
//   status === 'authed' → proceed normally
//   status === 'unknown' → render a neutral placeholder

'use client';

import { useEffect, useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabase/client';

export type AuthStatus = 'unknown' | 'anon' | 'authed';

interface AuthState {
  status: AuthStatus;
  email: string | null;
}

let _cached: { status: AuthStatus; email: string | null } | null = null;
const _listeners = new Set<(s: AuthState) => void>();

function emit(s: AuthState) {
  _cached = s;
  for (const l of _listeners) l(s);
}

if (typeof window !== 'undefined') {
  // Bootstrap the singleton once per browser session. Supabase may not be
  // configured (env vars unset) — we treat that as anon, never crash.
  (async () => {
    try {
      const supabase = getBrowserSupabase();
      const { data } = await supabase.auth.getUser();
      emit({ status: data.user ? 'authed' : 'anon', email: data.user?.email ?? null });
      supabase.auth.onAuthStateChange((_evt, session) => {
        emit({ status: session?.user ? 'authed' : 'anon', email: session?.user?.email ?? null });
      });
    } catch {
      // Supabase not configured → treat as anon (silent fallback).
      emit({ status: 'anon', email: null });
    }
  })();
}

export function useAuthStatus(): AuthState {
  const [state, setState] = useState<AuthState>(_cached ?? { status: 'unknown', email: null });
  useEffect(() => {
    const listener = (s: AuthState) => setState(s);
    _listeners.add(listener);
    // If we hydrated before the singleton emitted, sync now.
    if (_cached && _cached.status !== state.status) setState(_cached);
    return () => { _listeners.delete(listener); };
  }, [state.status]);
  return state;
}

/**
 * Wrap a navigation href so anon users get routed through /login with a `next`
 * param back to the original destination. Authed users go straight to the href.
 * Also a no-op for callers that haven't enabled Supabase (status stays anon
 * but we don't want to break apps running without auth).
 */
export function gateHref(href: string, status: AuthStatus, enabled = true): string {
  if (!enabled) return href;
  if (status !== 'anon') return href;
  // Don't gate already-protective destinations.
  if (href.startsWith('/login') || href.startsWith('/auth')) return href;
  return `/login?next=${encodeURIComponent(href)}`;
}