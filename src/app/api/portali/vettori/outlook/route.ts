import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { requireVettori } from "@/lib/portali/vettori/api-guard";
import { VETTORI_RUOLI } from "@/lib/portali/vettori/ruoli";
import { MailConfig } from "@/lib/portali/vettori/mail-config";
import { createAdminClient } from "@/lib/supabase/admin";
const Bozza = MailConfig.omit({ vettore_id: true }).refine((b) => b.destinatari.length > 0, "Configura almeno un destinatario nelle impostazioni email.");
export async function POST(request: NextRequest) {
  const guard = await requireVettori({ ruoli: [VETTORI_RUOLI.amministrazione] });
  if (!guard.ok) return guard.response;
  const p = Bozza.safeParse(await request.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues.map((i) => i.message).join(" ") }, { status: 400 });
  const token = randomBytes(32).toString("hex");
  const { error } = await createAdminClient().schema("vettori").rpc("prepara_bozza_outlook", {
    p_hash: createHash("sha256").update(token).digest("hex"), p_bozza: p.data, p_utente: guard.user.id,
  });
  if (error) return NextResponse.json({ error: "Impossibile preparare l’apertura in Outlook. Riprovare." }, { status: 500 });
  return NextResponse.json({ url: `sics-outlook:bozza/${token}` }, { headers: { "Cache-Control": "no-store" } });
}
