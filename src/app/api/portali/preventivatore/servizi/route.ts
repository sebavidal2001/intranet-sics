import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso, hasMinLivello } from "@/lib/auth/portale";
import { logError } from "@/lib/logger";
import { ServizioConfigurazioneSchema } from "@/lib/portali/preventivatore/documenti-schema";
import { z } from "zod";

export const dynamic = "force-dynamic";

const creaServizioSchema = ServizioConfigurazioneSchema.extend({
  categoria: ServizioConfigurazioneSchema.shape.categoria.optional().default("Manodopera"),
  tariffa_ora: ServizioConfigurazioneSchema.shape.tariffa_ora.optional().default(0),
  unita: z.string().trim().min(1).max(16).optional().default("h"),
  ordine: z.number().finite().nonnegative().optional().default(999),
  is_attivo: z.boolean().optional().default(true),
  scala_con_quantita: z.boolean().optional().default(true),
});

/**
 * GET  — elenco servizi/lavorazioni (default solo attivi; `?all=1` include i disattivati)
 * POST — crea un nuovo servizio (solo admin del portale)
 *
 * Tabella: preventivatore.servizi_manodopera
 */

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (livello === null) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });

    const includiInattivi = request.nextUrl.searchParams.get("all") === "1";

    const adminClient = createAdminClient();
    let query = adminClient
      .schema("preventivatore")
      .from("servizi_manodopera")
      .select("id, nome, categoria, tariffa_ora, unita, ordine, is_attivo, scala_con_quantita")
      .order("ordine", { ascending: true });

    if (!includiInattivi) query = query.eq("is_attivo", true);

    const { data, error } = await query;
    if (error) {
      logError("preventivatore.servizi", "Servizi fetch error", error);
      return NextResponse.json({ error: "Errore recupero servizi" }, { status: 500 });
    }
    return NextResponse.json(data ?? []);
  } catch (error) {
    logError("preventivatore.servizi", "Servizi route error", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (!hasMinLivello(livello, "admin")) {
      return NextResponse.json({ error: "Accesso negato" }, { status: 403 });
    }

    const parsed = creaServizioSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Payload non valido" }, { status: 400 });
    }
    const body = parsed.data;

    const adminClient = createAdminClient();
    const { data, error } = await adminClient
      .schema("preventivatore")
      .from("servizi_manodopera")
      .insert({
        nome: body.nome,
        categoria: body.categoria || "Manodopera",
        tariffa_ora: body.tariffa_ora,
        unita: body.unita,
        ordine: body.ordine,
        is_attivo: body.is_attivo,
        scala_con_quantita: body.scala_con_quantita,
      })
      .select("id, nome, categoria, tariffa_ora, unita, ordine, is_attivo, scala_con_quantita")
      .single();

    if (error) {
      logError("preventivatore.servizi", "Servizio create error", error);
      return NextResponse.json({ error: "Errore creazione servizio" }, { status: 500 });
    }
    return NextResponse.json(data);
  } catch (error) {
    logError("preventivatore.servizi", "Servizi POST error", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
