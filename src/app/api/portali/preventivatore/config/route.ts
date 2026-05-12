import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso, hasMinLivello } from "@/lib/auth/portale";
import { invalidateAiConfigCache } from "@/lib/portali/preventivatore/chat/config-cache";

export const dynamic = "force-dynamic";

const ALLOWED_CONFIG_KEYS = new Set([
  "company_knowledge",
  "system_prompt_preciso",
  "system_prompt_creativo",
  "soglia_similarity",
  "temperatura_precisa",
  "temperatura_creativa",
  "max_chunks_per_query",
  "modello_embedding",
  "modello_generazione",
  "ai_cost_counter_enabled",
]);

export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    }

    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (!hasMinLivello(livello, "admin")) {
      return NextResponse.json({ error: "Accesso negato" }, { status: 403 });
    }

    const adminClient = createAdminClient();
    const { data, error } = await adminClient
      .schema("preventivatore")
      .from("ai_config")
      .select("id, chiave, valore")
      .order("chiave");

    if (error) {
      console.error("Config fetch error:", error);
      return NextResponse.json({ error: "Errore recupero configurazione" }, { status: 500 });
    }

    return NextResponse.json(data ?? []);
  } catch (error) {
    console.error("Config GET error:", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    }

    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (!hasMinLivello(livello, "admin")) {
      return NextResponse.json({ error: "Accesso negato" }, { status: 403 });
    }

    const body = await request.json() as Record<string, unknown>;
    const adminClient = createAdminClient();

    const upsertRows = Object.entries(body)
      .filter(([chiave]) => ALLOWED_CONFIG_KEYS.has(chiave))
      .map(([chiave, valore]) => ({
        chiave,
        valore: String(valore ?? ""),
      }));

    if (upsertRows.length === 0) {
      return NextResponse.json({ error: "Nessuna chiave valida da salvare" }, { status: 400 });
    }

    const { error } = await adminClient
      .schema("preventivatore")
      .from("ai_config")
      .upsert(upsertRows, { onConflict: "chiave" });

    if (error) {
      console.error("Config upsert error:", error);
      return NextResponse.json({ error: "Errore salvataggio configurazione" }, { status: 500 });
    }

    invalidateAiConfigCache();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Config PATCH error:", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
