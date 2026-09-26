
import Link from "next/link";
import { EditorAnalisi } from "@/components/prototipo-bi/editor-analisi";
import { verificaAccessoSicuro } from "@/lib/prototipo-bi/accesso";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TipoGrafico } from "@/lib/prototipo-bi/scelta-grafico";
import type { AspettoGrafico, SerieAnalisi, SpecQuery } from "@/lib/prototipo-bi/tipi";

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
  aspetto: AspettoGrafico | null;
  modificabile: boolean;
}

function eOggetto(valore: unknown): valore is Record<string, unknown> {
  return typeof valore === "object" && valore !== null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * L'analisi da riaprire, letta direttamente dal database.
 *
 * Prima la pagina chiamava la propria API (`/api/bi/analisi`) ricostruendo
 * l'indirizzo da `host` e `x-forwarded-proto`. Dietro nginx quell'intestazione
 * non arriva: la chiamata partiva in http, nginx rispondeva 301 verso https e
 * nel salto di schema Node scarta il cookie. L'API rispondeva 401 e ogni
 * «Modifica» finiva su «Analisi non disponibile», per qualunque grafico.
 *
 * Le regole sono le stesse della GET dell'API: accesso al portale, e visibile
 * solo se tua o condivisa; modificabile solo se tua e non del Cruscotto.
 */
async function caricaAnalisi(id: string): Promise<AnalisiSalvata | undefined> {
  if (!UUID.test(id)) return undefined;
  const esito = await verificaAccessoSicuro();
  if (!esito.ok) return undefined;
  const { userId } = esito.accesso;

  const { data, error } = await createAdminClient()
    .schema("bi_direzionale")
    .from("analisi")
    .select("id,titolo,spec,serie,grafico,aspetto,autore_id,visibilita,chiave")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return undefined;
  if (data.autore_id !== userId && data.visibilita !== "condivisa") return undefined;
  if (typeof data.titolo !== "string" || !eOggetto(data.spec)) return undefined;

  return {
    id: String(data.id),
    titolo: data.titolo,
    spec: data.spec as unknown as SpecQuery,
    serie: Array.isArray(data.serie) ? (data.serie as SerieAnalisi[]) : null,
    grafico: typeof data.grafico === "string" ? (data.grafico as TipoGrafico) : undefined,
    aspetto: eOggetto(data.aspetto) ? (data.aspetto as AspettoGrafico) : null,
    modificabile: data.autore_id === userId && data.chiave === null,
  };
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
      aspettoIniziale={analisi?.aspetto}
      modificabile={analisi?.modificabile ?? true}
    />
  );
}
