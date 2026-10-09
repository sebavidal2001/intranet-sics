import { NextRequest, NextResponse } from "next/server";
import { preliminari, errore, negato } from "../../_comune";
import { archiviaMisura, leggiMisura } from "@/lib/prototipo-bi/misure-catalogo";
import { UUID_VALIDO, registraOperazione } from "../../dashboard/_utili";

export const dynamic = "force-dynamic";

/**
 * Toglie una misura dal catalogo (la archivia: non si cancella).
 * I riquadri che ne portano una copia continuano a funzionare e a dare gli
 * stessi numeri: il catalogo serve a trovarla, non a calcolarla.
 */
export async function DELETE(_request: NextRequest, contesto: { params: Promise<{ id: string }> }) {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;
  if (pre.accesso.soloAssegnate) return negato("Le misure le gestiscono la direzione e i responsabili.");

  const { id } = await contesto.params;
  if (!UUID_VALIDO.test(id)) return errore("Identificativo non valido.");

  try {
    const misura = await leggiMisura(id);
    if (!misura || misura.archiviata) return errore("Misura non trovata.", 404);
    if (misura.autoreId !== pre.accesso.userId && !pre.accesso.gestisceDashboard) {
      await registraOperazione(pre.accesso, "negato", { errore: "Archiviazione di una misura altrui." });
      return negato("Una misura la toglie il suo autore o la direzione.");
    }
    await archiviaMisura(id);
    await registraOperazione(pre.accesso, "ok", { righe: 1 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    await registraOperazione(pre.accesso, "errore", { errore: e instanceof Error ? e.message : "misura" });
    return errore("Impossibile togliere la misura.", 500);
  }
}
