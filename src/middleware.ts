import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            // Rende i cookie auth session-only (niente maxAge/expires) così
            // vengono eliminati alla chiusura del browser — coerente con
            // il sessionStorage usato dal client-side Supabase.
            const isAuthCookie =
              name.includes("auth-token") || name.includes("refresh-token");
            const cookieOptions = isAuthCookie
              ? { ...options, maxAge: undefined, expires: undefined }
              : options;
            supabaseResponse.cookies.set(name, value, cookieOptions);
          });
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  const pathname = request.nextUrl.pathname;

  // Route pubbliche
  if (pathname === "/api/ping") {
    return supabaseResponse;
  }

  // Cambio password: deve funzionare anche da NON autenticato (pulsante
  // "Cambia password" nella pagina di login). La route verifica da sé la
  // vecchia password ed è protetta da rate limiting. Senza questa eccezione il
  // blocco 401 più sotto la renderebbe irraggiungibile.
  if (pathname === "/api/auth/cambio-password") {
    return supabaseResponse;
  }

  if (pathname.startsWith("/auth/login")) {
    if (user) return NextResponse.redirect(new URL("/", request.url));
    return supabaseResponse;
  }

  // Non autenticato
  if (!user) {
    // Le route API rispondono in JSON: un redirect 302 a una pagina HTML di login
    // confonde i client `fetch` che si aspettano JSON. Restituiamo 401.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  // Nota: /superadmin/* non ha più una guard DB nel middleware — la query
  // causava un round-trip al DB su ogni request. Il layout superadmin
  // (src/app/(superadmin)/superadmin/layout.tsx) verifica il ruolo e
  // reindirizza se non autorizzato prima di renderizzare qualsiasi contenuto.
  // Stessa logica per /admin/* e /analisi/admin.

  // Vecchio /dashboard → redirect alla nuova home
  if (pathname === "/dashboard") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|logo|fonts|images|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
