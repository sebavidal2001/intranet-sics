import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePreventivatore } from "@/lib/portali/preventivatore/api-guard";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const guard = await requirePreventivatore();
    if (!guard.ok) return guard.response;

    const adminClient = createAdminClient();
    const { data, error } = await adminClient
      .schema("preventivatore")
      .from("motivi_rifiuto")
      .select("id, label, ordine")
      .eq("is_attivo", true)
      .order("ordine");

    if (error) {
      logError("preventivatore.motivi-rifiuto", "Motivi rifiuto error", error);
      return NextResponse.json(
        { error: "Errore recupero motivi rifiuto" },
        { status: 500 }
      );
    }

    return NextResponse.json(data ?? []);
  } catch (error) {
    logError("preventivatore.motivi-rifiuto", "Motivi rifiuto GET error", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
