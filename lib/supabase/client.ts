// Browser-side Supabase client. Singleton — safe to call multiple times.
// Uses NEXT_PUBLIC_* env vars (safe to expose to the client).

'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './types';

let _client: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function getBrowserSupabase(): ReturnType<typeof createBrowserClient<Database>> {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set');
  }
  _client = createBrowserClient<Database>(url, key);
  return _client;
}
