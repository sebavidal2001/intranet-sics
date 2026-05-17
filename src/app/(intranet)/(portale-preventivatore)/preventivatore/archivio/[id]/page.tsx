import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { DettaglioPreventivoView } from "@/components/portali/preventivatore/dettaglio-view";
import type {
  PreventivoDettaglio,
  PreventivoChunkRaw,
  PreventivoRigaRaw,
} from "@/components/portali/preventivatore/dettaglio-view-types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dettaglio Preventivo",
};

export default async function DettaglioPreventivoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Validazione UUID minimale per evitare query a vuoto
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const sb = createAdminClient();

  const [docRes, chunksRes, righeRes] = await Promise.all([
    sb
      .schema("preventivatore")
      .from("documenti")
      .select(
        "id, codice, cliente, tipo, categoria, tipo_prodotto, anno, stato, motivo_rifiuto_id, stato_note, numero_offerta, data_offerta, importo_preventivo, importo_ordinato, importo_finale_raw, importo_source, codici_articolo, tags, note, versione_ingest, created_at, updated_at"
      )
      .eq("id", id)
      .maybeSingle(),
    sb
      .schema("preventivatore")
      .from("chunks")
      .select("id, chunk_index, contenuto, metadata")
      .eq("documento_id", id)
      .order("chunk_index", { ascending: true }),
    sb
      .schema("preventivatore")
      .from("righe_distinta")
      .select("id, sheet_name, codice_articolo, descrizione, quantita, prezzo_unitario, ricarico_pct, totale_riga, codice_blocco")
      .eq("documento_id", id)
      .order("sheet_name", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true }),
  ]);

  if (docRes.error) throw docRes.error;
  if (!docRes.data) notFound();
  if (chunksRes.error) throw chunksRes.error;
  if (righeRes.error) throw righeRes.error;

  let motivoRifiutoLabel: string | null = null;
  if (docRes.data.motivo_rifiuto_id) {
    const { data: mr } = await sb
      .schema("preventivatore")
      .from("motivi_rifiuto")
      .select("label")
      .eq("id", docRes.data.motivo_rifiuto_id)
      .maybeSingle();
    motivoRifiutoLabel = (mr as { label: string } | null)?.label ?? null;
  }

  const dettaglio: PreventivoDettaglio = {
    documento: docRes.data as PreventivoDettaglio["documento"],
    chunks: (chunksRes.data ?? []) as unknown as PreventivoChunkRaw[],
    righe_distinta: (righeRes.data ?? []) as unknown as PreventivoRigaRaw[],
    motivo_rifiuto_label: motivoRifiutoLabel,
  };

  return <DettaglioPreventivoView dettaglio={dettaglio} />;
}
