import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
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

    const { searchParams } = new URL(request.url);
    const statsMode = searchParams.get("stats") === "true";

    const adminClient = createAdminClient();

    if (statsMode) {
      // Return aggregated stats
      const { data: docs, error: docsError } = await adminClient
        .schema("preventivatore")
        .from("documenti")
        .select("stato");

      const { count: chunksCount, error: chunksError } = await adminClient
        .schema("preventivatore")
        .from("chunks")
        .select("*", { count: "exact", head: true });

      if (docsError) {
        return NextResponse.json({ error: "Errore recupero statistiche" }, { status: 500 });
      }

      const allDocs = docs ?? [];
      return NextResponse.json({
        totale: allDocs.length,
        pending: allDocs.filter((d) => d.stato === "pending").length,
        ordinato: allDocs.filter((d) => d.stato === "ordinato").length,
        rifiutato: allDocs.filter((d) => d.stato === "rifiutato").length,
        total_chunks: chunksCount ?? 0,
      });
    }

    // List documents
    const stato = searchParams.get("stato");
    const page = parseInt(searchParams.get("page") ?? "1", 10);
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "20", 10), 100);
    const offset = (page - 1) * limit;

    let query = adminClient
      .schema("preventivatore")
      .from("documenti")
      .select("id, codice, cliente, stato, categoria, numero_offerta, data_offerta, created_at")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (stato) {
      query = query.eq("stato", stato);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Documenti list error:", error);
      return NextResponse.json({ error: "Errore recupero documenti" }, { status: 500 });
    }

    return NextResponse.json(data ?? []);
  } catch (error) {
    console.error("Documenti GET error:", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
