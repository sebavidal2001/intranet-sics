import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";

export const dynamic = "force-dynamic";

type UsageRow = {
  cost_amount: number | string | null;
  created_at: string;
}

function sumCost(rows: UsageRow[] | null | undefined) {
  return (rows ?? []).reduce((sum, row) => sum + Number(row.cost_amount ?? 0), 0);
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (livello === null) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });

    const sessioneId = new URL(request.url).searchParams.get("sessione_id");
    const admin = createAdminClient();

    const { data: counterCfg } = await admin
      .schema("preventivatore")
      .from("ai_config")
      .select("valore")
      .eq("chiave", "ai_cost_counter_enabled")
      .maybeSingle();

    const enabled = counterCfg?.valore !== "false";

    if (!enabled) {
      return NextResponse.json({
        enabled,
        currency: "usd",
        today: 0,
        last_30_days: 0,
        session: 0,
        source: "openrouter",
      });
    }

    const now = new Date();
    const startToday = new Date(now);
    startToday.setHours(0, 0, 0, 0);
    const start30 = new Date(now);
    start30.setDate(start30.getDate() - 30);

    const [todayRes, last30Res, sessionRes] = await Promise.all([
      admin
        .schema("preventivatore")
        .from("ai_usage_events")
        .select("cost_amount, created_at")
        .eq("user_id", user.id)
        .gte("created_at", startToday.toISOString()),
      admin
        .schema("preventivatore")
        .from("ai_usage_events")
        .select("cost_amount, created_at")
        .eq("user_id", user.id)
        .gte("created_at", start30.toISOString()),
      sessioneId
        ? admin
            .schema("preventivatore")
            .from("ai_usage_events")
            .select("cost_amount, created_at")
            .eq("user_id", user.id)
            .eq("sessione_id", sessioneId)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const error = todayRes.error ?? last30Res.error ?? sessionRes.error;
    if (error) {
      console.error("usage summary error:", error);
      return NextResponse.json({ error: "Errore recupero costi AI" }, { status: 500 });
    }

    return NextResponse.json({
      enabled,
      currency: "usd",
      today: sumCost(todayRes.data as UsageRow[]),
      last_30_days: sumCost(last30Res.data as UsageRow[]),
      session: sumCost(sessionRes.data as UsageRow[]),
      source: "openrouter",
    });
  } catch (error) {
    console.error("usage summary unexpected:", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
