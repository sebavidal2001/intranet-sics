/** ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE */

import { NextRequest, NextResponse } from "next/server";
import { preliminari } from "../_comune";
import { ottieniCruscottoArticoli } from "@/lib/prototipo-bi/articoli";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;

  const p = request.nextUrl.searchParams;
  try {
    const dati = await ottieniCruscottoArticoli({
      cerca: p.get("cerca")?.slice(0, 100) || undefined,
      categoria: p.get("categoria")?.slice(0, 120) || undefined,
      fornitore: p.get("fornitore")?.slice(0, 120) || undefined,
      magazzino: p.get("magazzino")?.slice(0, 60) || undefined,
      soloCritici: p.get("critici") === "1",
    });
    return NextResponse.json(dati);
  } catch (e) {
    console.error("[prototipo-bi.articoli]", e);
    return NextResponse.json(
      { error: "Dati articoli non disponibili. Verifica la connessione alla sorgente e riprova." },
      { status: 500 }
    );
  }
}
