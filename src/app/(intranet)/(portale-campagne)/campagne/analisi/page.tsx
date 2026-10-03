import { BarChart3 } from "lucide-react";
import { AnalisiView, SceltaCampagnaEFinestra } from "@/components/portali/campagne/analisi-view";
import { TitoloPagina, Vuoto } from "@/components/portali/campagne/ui";
import { finestraValida, ordineValido } from "@/lib/portali/campagne/analisi";
import { analisiCampagna } from "@/lib/portali/campagne/analisi-dati";
import { elencoCampagne } from "@/lib/portali/campagne/dati";
import { richiediAdmin } from "@/lib/portali/campagne/pagine";

export const metadata = { title: "Analisi" };
export const dynamic = "force-dynamic";

const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Cosa è successo agli acquisti dei clienti dopo la busta. Solo admin: il back
 * office lavora su clienti e invii, non sull'esito commerciale.
 */
export default async function AnalisiPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await richiediAdmin();
  const campagne = await elencoCampagne();

  if (campagne.length === 0) {
    return (
      <div className="mx-auto max-w-5xl">
        <TitoloPagina icona={BarChart3} titolo="Analisi" />
        <Vuoto titolo="Nessuna campagna" testo="Crea una campagna dalla pagina Campagne: l'analisi parte da chi l'ha ricevuta." />
      </div>
    );
  }

  const richiesta = uno(searchParams.campagna);
  // Di default la campagna con più buste consegnate: è quella con qualcosa da dire.
  const predefinita = [...campagne].sort((a, b) => b.consegnate + b.consegnate_banco - (a.consegnate + a.consegnate_banco))[0];
  const scelta = campagne.find((c) => c.id === richiesta) ?? predefinita;
  const mesi = finestraValida(uno(searchParams.mesi));
  const ordine = ordineValido(uno(searchParams.ordine));
  const analisi = await analisiCampagna(scelta.id, mesi);

  return (
    <div className="mx-auto max-w-5xl">
      <TitoloPagina
        icona={BarChart3}
        titolo="Analisi"
        sottotitolo="Quanto hanno comprato i clienti nei mesi prima e dopo aver ricevuto la busta, e chi ha comprato per la prima volta i prodotti della campagna."
      />
      <SceltaCampagnaEFinestra campagne={campagne} scelta={scelta.id} mesi={mesi} ordine={ordine} />
      <AnalisiView analisi={analisi} ordine={ordine} />
    </div>
  );
}
