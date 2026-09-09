import { NextRequest, NextResponse } from "next/server";
import { requireVettori } from "@/lib/portali/vettori/api-guard";
import { VETTORI_RUOLI } from "@/lib/portali/vettori/ruoli";
import { createAdminClient } from "@/lib/supabase/admin";
import { MailConfig } from "@/lib/portali/vettori/mail-config";

export async function GET() {
  const guard = await requireVettori({ ruoli: [VETTORI_RUOLI.amministrazione] });
  if (!guard.ok) return guard.response;
  const { data, error } = await createAdminClient().schema("vettori").from("mail_modelli").select("vettore_id, oggetto, corpo, destinatari, cc").eq("attivo", true);
  return error ? NextResponse.json({ error: "Lettura modelli non riuscita." }, { status: 500 }) : NextResponse.json({ modelli: data });
}
export async function PUT(request: NextRequest) {
  const guard = await requireVettori({ ruoli: [VETTORI_RUOLI.amministrazione] });
  if (!guard.ok) return guard.response;
  const p = MailConfig.safeParse(await request.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues.map((i) => i.message).join(" ") }, { status: 400 });
  const db = createAdminClient().schema("vettori");
  let q = db.from("mail_modelli").select("id").eq("attivo", true);
  q = p.data.vettore_id ? q.eq("vettore_id", p.data.vettore_id) : q.is("vettore_id", null);
  const { data, error: readError } = await q.maybeSingle();
  if (readError) return NextResponse.json({ error: "Impossibile leggere il modello. Riprovare." }, { status: 500 });
  const row = { ...p.data, nome: "Contestazione vettori", aggiornato_da: guard.user.id, aggiornato_il: new Date().toISOString() };
  const { error } = data ? await db.from("mail_modelli").update(row).eq("id", data.id) : await db.from("mail_modelli").insert(row);
  return error ? NextResponse.json({ error: "Salvataggio non riuscito. Ricaricare i modelli e riprovare." }, { status: 409 }) : NextResponse.json({ ok: true });
}
