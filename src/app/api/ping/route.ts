import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

/**
 * Keep-alive endpoint per Supabase free tier.
 * Da chiamare ogni 4 giorni via cron sul server per evitare il freeze del DB.
 *
 * Esempio crontab sulla VM:
 *   0 8 * /4 * * curl -s https://TUO-DOMINIO/api/ping >> /var/log/supabase-ping.log 2>&1
 */
export async function GET() {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("scale_valutazione")
    .select("id")
    .limit(1);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ts: new Date().toISOString() });
}
