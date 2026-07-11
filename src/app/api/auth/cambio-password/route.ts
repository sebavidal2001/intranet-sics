import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { usernameToEmailCandidates } from "@/lib/auth/username";
import { logError, logWarn } from "@/lib/logger";
import { checkRateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/cambio-password
 *
 * Cambia la password di un utente. Funziona sia da utente loggato sia da
 * non loggato (es. pulsante "Cambia password" nella pagina di login).
 *
 * Flusso:
 *  1. Deriva i candidati email dall'identificativo (username o email completa)
 *  2. Verifica la vecchia password autenticando con un client usa-e-getta
 *     (non tocca la sessione corrente)
 *  3. Cambia la password via Admin API (updateUserById)
 *  4. Marca `utenti.primo_accesso = false`
 *
 * Body: { identificativo: string, vecchiaPassword: string, nuovaPassword: string }
 */
export async function POST(request: NextRequest) {
  try {
    // Rate limit anti brute-force: la route verifica la vecchia password
    // autenticando, quindi è un oracolo di verifica. Limitiamo per IP.
    const rl = checkRateLimit(`cambio-pwd:${clientIp(request)}`, {
      limit: 5,
      windowMs: 15 * 60_000,
    });
    if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

    const body = await request.json();
    const identificativo = String(body?.identificativo ?? "").trim();
    const vecchiaPassword = String(body?.vecchiaPassword ?? "");
    const nuovaPassword = String(body?.nuovaPassword ?? "");

    if (!identificativo || !vecchiaPassword || !nuovaPassword) {
      return NextResponse.json({ error: "Tutti i campi sono obbligatori." }, { status: 400 });
    }
    if (nuovaPassword.length < 8) {
      return NextResponse.json(
        { error: "La nuova password deve essere di almeno 8 caratteri." },
        { status: 400 }
      );
    }
    if (nuovaPassword === vecchiaPassword) {
      return NextResponse.json(
        { error: "La nuova password deve essere diversa da quella attuale." },
        { status: 400 }
      );
    }

    // ── 1+2. Verifica la vecchia password autenticando (client isolato) ───────
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const verifier = createSupabaseClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let userId: string | null = null;
    for (const email of usernameToEmailCandidates(identificativo)) {
      const { data, error } = await verifier.auth.signInWithPassword({
        email,
        password: vecchiaPassword,
      });
      if (!error && data.user) {
        userId = data.user.id;
        // scope:"local" → chiude solo la sessione del client usa-e-getta.
        // Senza scope, signOut() è GLOBAL e revocherebbe TUTTE le sessioni
        // dell'utente (incluso il browser da cui sta cambiando la password).
        await verifier.auth.signOut({ scope: "local" });
        break;
      }
    }

    if (!userId) {
      return NextResponse.json(
        { error: "Username o password attuale non corretti." },
        { status: 401 }
      );
    }

    // ── 3. Cambia la password via Admin API ───────────────────────────────────
    const admin = createAdminClient();
    const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
      password: nuovaPassword,
    });
    if (updErr) {
      logError("auth.cambio-password", "cambio-password updateUserById", updErr);
      return NextResponse.json(
        { error: "Errore durante l'aggiornamento della password." },
        { status: 500 }
      );
    }

    // ── 4. Marca primo accesso completato ─────────────────────────────────────
    const { error: flagErr } = await admin
      .from("utenti")
      .update({ primo_accesso: false, updated_at: new Date().toISOString() })
      .eq("id", userId);
    if (flagErr) {
      // La password è già stata cambiata: logghiamo ma non blocchiamo.
      logWarn("auth.cambio-password", "cambio-password: flag primo_accesso non aggiornato", { dettaglio: flagErr });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logError("auth.cambio-password", "cambio-password error", error);
    return NextResponse.json({ error: "Errore del server." }, { status: 500 });
  }
}
