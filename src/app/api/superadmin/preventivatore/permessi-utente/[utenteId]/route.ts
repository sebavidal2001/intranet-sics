import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const PermessiBodySchema = z.object({
  ruoli_slug: z.array(z.string().trim().min(1).max(80)).max(20),
  agente_codice: z.string().trim().max(80).nullable(),
});

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
    logError("superadmin.preventivatore.permessi-utente", "GET permessi-utente", e);
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

    const parsed = PermessiBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload non valido", dettagli: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
        { status: 400 },
      );
    }
    const ruoliSlug = [...new Set(parsed.data.ruoli_slug)];
    const agenteCodice = parsed.data.agente_codice || null;

    const admin = createAdminClient();

    const { error: rpcError } = await admin
      .schema("preventivatore")
      .rpc("salva_permessi_utente", {
        p_utente: utenteId,
        p_codice_agente: agenteCodice,
        p_ruoli: ruoliSlug,
      });
    if (rpcError) {
      logError("superadmin.preventivatore.permessi-utente", "salva_permessi_utente", rpcError);
      return NextResponse.json({ error: "Errore salvataggio permessi" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    logError("superadmin.preventivatore.permessi-utente", "POST permessi-utente", e);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
