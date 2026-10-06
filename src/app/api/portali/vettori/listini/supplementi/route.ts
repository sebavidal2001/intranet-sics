import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireVettori } from "@/lib/portali/vettori/api-guard";
import { VETTORI_RUOLI } from "@/lib/portali/vettori/ruoli";
import { codiceSupplemento, NuovoSupplemento } from "@/lib/portali/vettori/listini-config";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/portali/vettori/listini/supplementi
 *
 * Aggiunge un supplemento a periodo al listino in vigore (es. FedEx, «Diritto
 * fisso» di 0,85 € dal 01/11 al 31/12). Le voci già presenti si cambiano con la
 * versione del listino; questa è l'unica strada per una voce nuova.
 */
export async function POST(request: NextRequest) {
  const guard = await requireVettori({ ruoli: [VETTORI_RUOLI.amministrazione] });
  if (!guard.ok) return guard.response;

  const parsed = NuovoSupplemento.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join(". ") }, { status: 400 });
  }
  const s = parsed.data;
  const codice = codiceSupplemento(s.nome);
  if (!codice) {
    return NextResponse.json({ error: "Il nome deve contenere almeno una lettera o un numero." }, { status: 400 });
  }

  const { data, error } = await createAdminClient().schema("vettori").rpc("aggiungi_supplemento", {
    p_payload: { ...s, codice, valido_al: s.valido_al ?? null },
    p_utente: guard.user.id,
  });
  if (error) {
    logError("vettori.listini", "Aggiunta supplemento fallita", error);
    return NextResponse.json(
      { error: error.code === "P0001" ? error.message : "Salvataggio non riuscito. Verificare che la migrazione dei supplementi a periodo sia applicata e riprovare." },
      { status: error.code === "P0001" ? 409 : 500 }
    );
  }
  return NextResponse.json({ id: data, codice });
}

const Rimozione = z.object({ listino_id: z.string().uuid(), codice: z.string().min(1).max(60) });

/** Toglie un supplemento a periodo (le voci permanenti del listino restano). */
export async function DELETE(request: NextRequest) {
  const guard = await requireVettori({ ruoli: [VETTORI_RUOLI.amministrazione] });
  if (!guard.ok) return guard.response;

  const parsed = Rimozione.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Richiesta non valida." }, { status: 400 });

  const { error } = await createAdminClient().schema("vettori").rpc("rimuovi_supplemento", {
    p_listino: parsed.data.listino_id, p_codice: parsed.data.codice,
  });
  if (error) {
    logError("vettori.listini", "Rimozione supplemento fallita", error);
    return NextResponse.json(
      { error: error.code === "P0001" ? error.message : "Rimozione non riuscita." },
      { status: error.code === "P0001" ? 409 : 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
