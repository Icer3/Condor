// Server-side Supabase client. One per request — uses Next.js cookies() API
// so the user's JWT is sent through automatically. Reads the same NEXT_PUBLIC_*
// vars as the browser client because we want RLS to see the user (we're acting on
// their behalf, not with elevated service-role privileges).
//
// For admin operations, import `getServiceSupabase()` separately.

import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from './types';

export async function getServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set');
  }
  const cookieStore = await cookies();
  return createServerClient<Database>(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components can't set cookies; this is normal inside RSC reads.
          // The middleware layer handles cookie refresh; ignore here.
        }
      },
    },
  });
}

/** Get the current authenticated user (or null if anonymous). Use this in API routes. */
export async function getCurrentUserId(): Promise<string | null> {
  try {
    const supabase = await getServerSupabase();
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}
