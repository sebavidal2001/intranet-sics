import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireVettori } from "@/lib/portali/vettori/api-guard";
import { VETTORI_RUOLI } from "@/lib/portali/vettori/ruoli";
import { NuovoListino } from "@/lib/portali/vettori/listini-config";
import { logError } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const guard = await requireVettori({ ruoli: [VETTORI_RUOLI.amministrazione] });
  if (!guard.ok) return guard.response;
  const body = await request.json().catch(() => null);
  const parsed = NuovoListino.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join(" ") }, { status: 400 });
  const { data, error } = await createAdminClient().schema("vettori").rpc("versiona_listino", {
    p_payload: parsed.data, p_utente: guard.user.id,
  });
  if (error) {
    logError("vettori.listini", "Salvataggio listino fallito", error);
    return NextResponse.json({ error: error.code === "P0001" ? error.message : "Salvataggio non riuscito. Verificare che la migrazione dei listini configurabili sia applicata e riprovare." }, { status: error.code === "P0001" ? 409 : 500 });
  }
  return NextResponse.json({ id: data });
}
