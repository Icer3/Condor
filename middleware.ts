// Root middleware: refreshes Supabase auth cookie on every request.
//
// Match all paths except static assets and Next.js internals. The auth
// callback route is explicitly excluded so Supabase can set cookies during
// the auth-code exchange.

import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Skip Next.js internals and all static files. Run on everything else.
     */
    '/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
