import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Permessi preventivatore per un utente (superadmin only):
 *  - ruoli funzionali in preventivatore.utente_ruoli_funzionali
 *  - utenti.preventivatore_agente_codice (codice agente del Cruscotto)
 *
 * GET  → { ruoli_slug: string[], agente_codice: string | null }
 * POST → idem (sovrascrive). Body: { ruoli_slug: string[], agente_codice: string | null }
 */

async function requireSuperadmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("utenti")
    .select("ruolo")
    .eq("id", user.id)
    .maybeSingle();
  if ((data?.ruolo as string | undefined) !== "superadmin") return null;
  return user;
}

export async function GET(
  _: NextRequest,
  { params }: { params: Promise<{ utenteId: string }> }
) {
  try {
    const me = await requireSuperadmin();
    if (!me) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

    const { utenteId } = await params;
    const admin = createAdminClient();

    const [ruoliRes, utenteRes] = await Promise.all([
      admin
        .schema("preventivatore")
        .from("utente_ruoli_funzionali")
        .select("ruolo:ruoli_funzionali(slug)")
        .eq("utente_id", utenteId),
      admin
        .from("utenti")
        .select("preventivatore_agente_codice")
        .eq("id", utenteId)
        .maybeSingle(),
    ]);

    const ruoli_slug = ((ruoliRes.data ?? []) as unknown as Array<{ ruolo: { slug: string } | null }>)
      .map((r) => r.ruolo?.slug)
      .filter((s): s is string => Boolean(s));

    return NextResponse.json({
      ruoli_slug,
      agente_codice: (utenteRes.data?.preventivatore_agente_codice as string | null) ?? null,
    });
  } catch (e) {
    console.error("GET permessi-utente:", e);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ utenteId: string }> }
) {
  try {
    const me = await requireSuperadmin();
    if (!me) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

    const { utenteId } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(utenteId)) {
      return NextResponse.json({ error: "utenteId non valido" }, { status: 400 });
    }

    const body = await request.json() as {
      ruoli_slug?: string[];
      agente_codice?: string | null;
    };
    const ruoliSlug = Array.isArray(body.ruoli_slug) ? body.ruoli_slug : [];
    const agenteCodice = (body.agente_codice ?? "").trim() || null;

    const admin = createAdminClient();

    // 1) update agente_codice su utenti
    const { error: uErr } = await admin
      .from("utenti")
      .update({ preventivatore_agente_codice: agenteCodice })
      .eq("id", utenteId);
    if (uErr) return NextResponse.json({ error: "Errore aggiornamento agente: " + uErr.message }, { status: 500 });

    // 2) lookup id dei ruoli richiesti
    let ruoliIds: string[] = [];
    if (ruoliSlug.length > 0) {
      const { data: ruoli, error: rfErr } = await admin
        .schema("preventivatore")
        .from("ruoli_funzionali")
        .select("id, slug")
        .in("slug", ruoliSlug);
      if (rfErr) return NextResponse.json({ error: "Errore lookup ruoli: " + rfErr.message }, { status: 500 });
      ruoliIds = (ruoli ?? []).map((r) => r.id as string);
    }

    // 3) sostituisci interamente le associazioni dell'utente (delete + insert)
    const { error: delErr } = await admin
      .schema("preventivatore")
      .from("utente_ruoli_funzionali")
      .delete()
      .eq("utente_id", utenteId);
    if (delErr) return NextResponse.json({ error: "Errore reset ruoli: " + delErr.message }, { status: 500 });

    if (ruoliIds.length > 0) {
      const payload = ruoliIds.map((rid) => ({
        utente_id: utenteId,
        ruolo_id: rid,
        assegnato_da: me.id,
        assegnato_il: new Date().toISOString(),
      }));
      const { error: insErr } = await admin
        .schema("preventivatore")
        .from("utente_ruoli_funzionali")
        .insert(payload);
      if (insErr) return NextResponse.json({ error: "Errore insert ruoli: " + insErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("POST permessi-utente:", e);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
