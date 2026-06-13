import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

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
    if (livello === null) {
      return NextResponse.json({ error: "Accesso negato" }, { status: 403 });
    }

    const adminClient = createAdminClient();

    const { data, error } = await adminClient
      .schema("preventivatore")
      .from("documenti")
      .select("cliente")
      .not("cliente", "is", null)
      .order("cliente", { ascending: true });

    if (error) {
      logError("preventivatore.documenti.clienti", "Clienti unici fetch error", error);
      return NextResponse.json({ error: "Errore recupero clienti" }, { status: 500 });
    }

    // Deduplicate in JS since Supabase JS client doesn't expose DISTINCT directly
    const unici = [
      ...new Set(
        (data ?? [])
          .map((r: { cliente: string | null }) => r.cliente)
          .filter((c): c is string => c !== null && c.trim() !== "")
      ),
    ].sort();

    return NextResponse.json(unici);
  } catch (error) {
    logError("preventivatore.documenti.clienti", "Clienti documenti route error", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
