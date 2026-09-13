
import { headers } from "next/headers";
import Link from "next/link";
import { EditorAnalisi } from "@/components/prototipo-bi/editor-analisi";
import type { TipoGrafico } from "@/lib/prototipo-bi/scelta-grafico";
import type { SerieAnalisi, SpecQuery } from "@/lib/prototipo-bi/tipi";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Esplora — BI Direzionale",
};

interface AnalisiSalvata {
  id: string;
  titolo: string;
  spec: SpecQuery;
  serie: SerieAnalisi[] | null;
  grafico?: TipoGrafico;
  modificabile: boolean;
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
    serie: Array.isArray(trovata.serie) ? (trovata.serie as SerieAnalisi[]) : null,
    grafico: typeof trovata.grafico === "string" ? (trovata.grafico as TipoGrafico) : undefined,
    modificabile: trovata.modificabile === true,
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

  if (id && !analisi) {
    return (
      <main className="flex-1 bg-bg-page px-4 py-10 text-text sm:px-6">
        <div className="mx-auto max-w-2xl border-y border-border py-10">
          <h1 className="font-tenorite text-2xl font-semibold">Analisi non disponibile</h1>
          <p className="mt-2 text-sm text-text-muted">Potrebbe essere stata eliminata oppure non essere condivisa con te.</p>
          <Link href="/bi/analisi" className="mt-5 inline-flex min-h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            Torna alle analisi
          </Link>
        </div>
      </main>
    );
  }

  return (
    <EditorAnalisi
      idAnalisi={analisi?.id}
      specIniziale={analisi?.spec}
      serieIniziali={analisi?.serie}
      titoloIniziale={analisi?.titolo}
      graficoIniziale={analisi?.grafico}
      modificabile={analisi?.modificabile ?? true}
    />
  );
}
