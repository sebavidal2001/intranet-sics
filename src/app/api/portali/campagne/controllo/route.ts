import { NextRequest, NextResponse } from "next/server";
import { requireCampagne } from "@/lib/portali/campagne/api-guard";
import { eseguiControlloCompleto, leggiUltimiControlli } from "@/lib/portali/campagne/controllo-dati";
import { rispondiErrore } from "@/lib/portali/campagne/risposte";
import { tokenValido } from "@/lib/portali/campagne/token";

export const dynamic = "force-dynamic";
// Il controllo legge qualche migliaio di righe e scrive poche decine: secondi, non minuti.
export const maxDuration = 120;

/**
 * POST — esegue il controllo contro i dati di Impresa gia' caricati.
 *
 * Due modi di autorizzarsi:
 *  - `Authorization: Bearer <CAMPAGNE_CONTROLLO_TOKEN>`: il timer notturno della VM.
 *    Il middleware lascia passare SOLO questa forma (POST con Bearer) e la verifica
 *    sta qui; se la variabile non e' impostata la risposta e' 503, mai un'apertura.
 *  - la sessione di un back office o di un admin: il pulsante «Ricontrolla».
 */
export async function POST(request: NextRequest) {
  try {
    const intestazione = request.headers.get("authorization");

    if (intestazione) {
      if (!process.env.CAMPAGNE_CONTROLLO_TOKEN) {
        return NextResponse.json({ error: "Controllo notturno non configurato" }, { status: 503 });
      }
      if (!tokenValido(intestazione, process.env.CAMPAGNE_CONTROLLO_TOKEN)) {
        return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
      }
      return NextResponse.json({ controllo: await eseguiControlloCompleto({ origine: "notturno", utenteId: null }) });
    }

    const guard = await requireCampagne({ chi: "operatore" });
    if (!guard.ok) return guard.response;
    return NextResponse.json({ controllo: await eseguiControlloCompleto({ origine: "manuale", utenteId: guard.user.id }) });
  } catch (e) {
    return rispondiErrore("controllo", e);
  }
}

/** GET — gli ultimi controlli eseguiti (operatore). */
export async function GET() {
  try {
    const guard = await requireCampagne({ chi: "operatore" });
    if (!guard.ok) return guard.response;
    return NextResponse.json({ controlli: await leggiUltimiControlli(10) });
  } catch (e) {
    return rispondiErrore("controllo.storico", e);
  }
}
