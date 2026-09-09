import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/** Solo il token monouso apre questa singola bozza; nessuna sessione trasferita al PC. */
export async function POST(request: NextRequest) {
  const token = request.headers.get("authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) return NextResponse.json({ error: "Collegamento non valido." }, { status: 401 });
  const { data, error } = await createAdminClient().schema("vettori").rpc("ritira_bozza_outlook", { p_hash: createHash("sha256").update(token).digest("hex") });
  if (error) return NextResponse.json({ error: "Servizio temporaneamente non disponibile." }, { status: 503 });
  if (!data) return NextResponse.json({ error: "Bozza scaduta o già aperta. Preparala di nuovo dal portale." }, { status: 410 });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
