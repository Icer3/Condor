// Session-refresh middleware. Runs on every non-asset request and:
//   1. Reads the user's auth cookies
//   2. Refreshes the access token if it's close to expiry
//   3. Forwards the user-id as x-user-id header so API routes don't have to
//      call auth.getUser() separately.
//
// This pattern comes from the official @supabase/ssr example.

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from './types';

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    // Env not configured — pass through. Login UI will surface this.
    return response;
  }

  const supabase = createServerClient<Database>(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: request.headers } });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // CRITICAL: getUser() refreshes the session if expired. Do not remove.
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    // Forward user id as a request header for downstream API routes.
    response.headers.set('x-user-id', user.id);
    response.headers.set('x-user-email', user.email ?? '');
  }

  return response;
}
