/** ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE */

import { headers } from "next/headers";
import { EditorAnalisi } from "@/components/prototipo-bi/editor-analisi";
import type { TipoGrafico } from "@/lib/prototipo-bi/scelta-grafico";
import type { SpecQuery } from "@/lib/prototipo-bi/tipi";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Esplora — Prototipo BI (non in produzione)",
};

interface AnalisiSalvata {
  id: string;
  titolo: string;
  spec: SpecQuery;
  grafico?: TipoGrafico;
}

function eOggetto(valore: unknown): valore is Record<string, unknown> {
  return typeof valore === "object" && valore !== null;
}

function leggiAnalisi(corpo: unknown, id: string): AnalisiSalvata | undefined {
  if (!eOggetto(corpo) || !Array.isArray(corpo.analisi)) return undefined;
  const trovata = corpo.analisi.find(
    (voce) => eOggetto(voce) && voce.id === id && typeof voce.titolo === "string" && eOggetto(voce.spec)
  );
  if (!eOggetto(trovata)) return undefined;
  return {
    id: String(trovata.id),
    titolo: String(trovata.titolo),
    spec: trovata.spec as unknown as SpecQuery,
    grafico: typeof trovata.grafico === "string" ? (trovata.grafico as TipoGrafico) : undefined,
  };
}

async function caricaAnalisi(id: string): Promise<AnalisiSalvata | undefined> {
  const intestazioni = await headers();
  const host = intestazioni.get("x-forwarded-host") ?? intestazioni.get("host");
  if (!host) return undefined;
  const protocollo = intestazioni.get("x-forwarded-proto") ?? "http";
  const cookie = intestazioni.get("cookie");
  const risposta = await fetch(`${protocollo}://${host}/api/bi/analisi`, {
    cache: "no-store",
    headers: cookie ? { cookie } : undefined,
  });
  if (!risposta.ok) return undefined;
  const corpo: unknown = await risposta.json();
  return leggiAnalisi(corpo, id);
}

export default async function PaginaEsplora({
  searchParams,
}: {
  searchParams: Promise<{ analisi?: string | string[] }>;
}) {
  const parametri = await searchParams;
  const id = Array.isArray(parametri.analisi) ? parametri.analisi[0] : parametri.analisi;
  const analisi = id ? await caricaAnalisi(id) : undefined;

  return (
    <EditorAnalisi
      specIniziale={analisi?.spec}
      titoloIniziale={analisi?.titolo}
      graficoIniziale={analisi?.grafico}
    />
  );
}
