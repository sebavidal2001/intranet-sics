import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";
import { DEFAULT_CONFIG } from "@/lib/portali/valutazioni/pdf/certificato";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = createAdminClient();
  const { data } = await db
    .from("certificato_config")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (!data) {
    return NextResponse.json(DEFAULT_CONFIG);
  }

  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

    const isAdmin = await isValutazioniAdmin(supabase, user.id);
    if (!isAdmin) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

    const db = createAdminClient();

    // Parsing body e lookup id in parallelo — risparmia un round-trip sequenziale
    const [body, { data: existing }] = await Promise.all([
      request.json(),
      db.from("certificato_config").select("id").limit(1).maybeSingle(),
    ]);

    const payload = {
      ...(existing?.id ? { id: existing.id } : {}),
      titoli_scheda: Array.isArray(body.titoli_scheda) ? body.titoli_scheda : DEFAULT_CONFIG.titoli_scheda,
      codice_documento: body.codice_documento ?? DEFAULT_CONFIG.codice_documento,
      data_edizione: body.data_edizione ?? "",
      data_aggiornamento: body.data_aggiornamento ?? "",
      colore_primario: body.colore_primario ?? DEFAULT_CONFIG.colore_primario,
      colore_testo: body.colore_testo ?? DEFAULT_CONFIG.colore_testo,
      font_corpo: body.font_corpo ?? DEFAULT_CONFIG.font_corpo,
      orientamento: body.orientamento ?? DEFAULT_CONFIG.orientamento,
      mostra_radar: body.mostra_radar ?? DEFAULT_CONFIG.mostra_radar,
      logo_url: body.logo_url ?? null,
      etichetta_area: body.etichetta_area ?? DEFAULT_CONFIG.etichetta_area,
      etichetta_responsabile: body.etichetta_responsabile ?? DEFAULT_CONFIG.etichetta_responsabile,
      etichetta_valutatore: body.etichetta_valutatore ?? DEFAULT_CONFIG.etichetta_valutatore,
      etichetta_data_assunzione: body.etichetta_data_assunzione ?? DEFAULT_CONFIG.etichetta_data_assunzione,
      etichetta_data_valutazione: body.etichetta_data_valutazione ?? DEFAULT_CONFIG.etichetta_data_valutazione,
      etichetta_anzianita: body.etichetta_anzianita ?? DEFAULT_CONFIG.etichetta_anzianita,
      updated_at: new Date().toISOString(),
    };

    const { error } = await db.from("certificato_config").upsert(payload);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore interno del server";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
