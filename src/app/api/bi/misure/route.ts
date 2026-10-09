import { NextRequest, NextResponse } from "next/server";
import { preliminari, errore, negato, snapshotPerimetrato } from "../_comune";
import { SpecNonValida } from "@/lib/prototipo-bi/semantico";
import { normalizzaValoriFiltri, validaMisura } from "@/lib/prototipo-bi/misure";
import {
  NomeGiaUsato,
  elencaMisure,
  leggiMisura,
  salvaMisura,
} from "@/lib/prototipo-bi/misure-catalogo";
import { UUID_VALIDO, oggettoJson, registraOperazione } from "../dashboard/_utili";

export const dynamic = "force-dynamic";

const MESSAGGIO_OPERATIVO =
  "Le misure le creano la direzione e i responsabili: tu usi quelle che compaiono nelle dashboard che ti sono state assegnate.";

/** Il catalogo condiviso fra chi costruisce dashboard. */
export async function GET() {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;
  if (pre.accesso.soloAssegnate) return negato(MESSAGGIO_OPERATIVO);

  try {
    const misure = await elencaMisure();
    return NextResponse.json({
      misure,
      // Chi puo' modificare o togliere: l'autore, e la direzione su tutte.
      utenteId: pre.accesso.userId,
      puoGestireTutte: pre.accesso.gestisceDashboard,
    });
  } catch (e) {
    await registraOperazione(pre.accesso, "errore", { errore: e instanceof Error ? e.message : "misure" });
    return errore("Impossibile leggere le misure.", 500);
  }
}

/**
 * Salva una misura. Body: { misura: { nome, espressione }, sostituisceId? }.
 * La definizione viene rivalidata qui: quello che arriva dal browser, anche se
 * l'ha proposto l'AI, non e' mai considerato valido finche' non passa dal
 * validatore.
 */
export async function POST(request: NextRequest) {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;
  if (pre.accesso.soloAssegnate) {
    await registraOperazione(pre.accesso, "negato", { errore: "Creazione misura non consentita al livello operativo." });
    return negato(MESSAGGIO_OPERATIVO);
  }

  let body: { misura?: unknown; sostituisceId?: unknown };
  try {
    body = await request.json();
  } catch {
    return errore("Body JSON non valido");
  }
  if (!oggettoJson(body.misura)) return errore("Misura mancante.");

  try {
    let sostituisce: { id: string; versione: number } | undefined;
    if (body.sostituisceId !== undefined && body.sostituisceId !== null) {
      if (typeof body.sostituisceId !== "string" || !UUID_VALIDO.test(body.sostituisceId)) {
        return errore("Identificativo della misura da sostituire non valido.");
      }
      const vecchia = await leggiMisura(body.sostituisceId);
      if (!vecchia || vecchia.archiviata) return errore("La misura da sostituire non esiste o e' gia' archiviata.", 404);
      if (vecchia.autoreId !== pre.accesso.userId && !pre.accesso.gestisceDashboard) {
        await registraOperazione(pre.accesso, "negato", { errore: "Modifica di una misura altrui." });
        return negato("Una misura la modifica il suo autore o la direzione.");
      }
      sostituisce = { id: vecchia.id, versione: vecchia.versione };
    }

    // I valori dei filtri si riportano alla grafia del dato visibile a chi salva.
    const snapshot = await snapshotPerimetrato(pre.accesso);
    const misura = normalizzaValoriFiltri(validaMisura(body.misura), snapshot);
    const salvata = await salvaMisura({ misura, autoreId: pre.accesso.userId, sostituisce });
    await registraOperazione(pre.accesso, "ok", { righe: 1 });
    return NextResponse.json({ misura: salvata }, { status: 201 });
  } catch (e) {
    if (e instanceof SpecNonValida) {
      return NextResponse.json({ error: e.message, suggerimento: e.suggerimento }, { status: 422 });
    }
    if (e instanceof NomeGiaUsato) return errore(e.message, 409);
    await registraOperazione(pre.accesso, "errore", { errore: e instanceof Error ? e.message : "misura" });
    return errore("Impossibile salvare la misura.", 500);
  }
}
