import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { getSupabaseConfig } from '@/lib/supabase/config';

const LOGIN_PATH = '/login';
// Oturumsuz açılabilen sayfalar; oturum varken açılırsa ana sayfaya yönlendirilir.
const PUBLIC_PATHS = new Set([LOGIN_PATH, '/register']);

/**
 * Her sayfa isteğinden önce çalışır: oturumu doğrular, süresi dolmak üzere olan token'ı yeniler ve
 * yenilenen çerezleri cevaba yazar. Oturum yoksa giriş sayfasına, oturum varken giriş veya kayıt sayfası açılırsa
 * ana sayfaya yönlendirir.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const { url, anonKey } = getSupabaseConfig();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // Oturum çerezi taşıyan cevap önbelleğe alınmamalı; aksi halde bir kullanıcının oturumu başkasına gidebilir.
        for (const [key, value] of Object.entries(headers)) {
          response.headers.set(key, value);
        }
      },
    },
  });

  // getClaims, token imzasını Supabase'in açık anahtarlarıyla doğrular ve gerekirse oturumu yeniler.
  // Çerezdeki oturuma doğrulamadan güvenilmez.
  const { data } = await supabase.auth.getClaims();
  const isLoggedIn = Boolean(data?.claims);
  const { pathname, search } = request.nextUrl;
  const isPublicPage = PUBLIC_PATHS.has(pathname);

  if (!isLoggedIn && !isPublicPage) {
    const loginUrl = new URL(LOGIN_PATH, request.url);
    loginUrl.searchParams.set('next', pathname + search);
    return redirectKeepingCookies(loginUrl, response);
  }
  if (isLoggedIn && isPublicPage) {
    return redirectKeepingCookies(new URL('/', request.url), response);
  }
  return response;
}

/** Yönlendirmede, yenilenen oturum çerezleri ve önbellek başlıkları kaybolmasın. */
function redirectKeepingCookies(target: URL, from: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(target);
  for (const cookie of from.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  for (const header of ['cache-control', 'expires', 'pragma']) {
    const value = from.headers.get(header);
    if (value) {
      redirect.headers.set(header, value);
    }
  }
  return redirect;
}

export const config = {
  // Statik dosyalar ve görseller oturum kontrolünden geçmez.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
