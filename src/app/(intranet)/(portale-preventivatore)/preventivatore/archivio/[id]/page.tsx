import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";
import {
  getFiltroCommerciale,
  getIdClientiVisibili,
} from "@/lib/portali/preventivatore/ruoli";
import { DettaglioPreventivoView } from "@/components/portali/preventivatore/dettaglio-view";
import type {
  PreventivoDettaglio,
  PreventivoChunkRaw,
  PreventivoRigaRaw,
  PreventivoBloccoRaw,
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

  // Auth + filtro commerciale ristretto
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
  if (livello === null) redirect("/");

  const agenteCommerciale = await getFiltroCommerciale(user.id, livello);

  const sb = createAdminClient();

  const [docRes, chunksRes, righeRes, blocchiRes] = await Promise.all([
    sb
      .schema("preventivatore")
      .from("documenti")
      .select(
        "id, codice, cliente, cliente_master_id, tipo, categoria, tipo_prodotto, anno, stato, motivo_rifiuto_id, stato_note, numero_offerta, data_offerta, importo_preventivo, importo_ordinato, importo_finale_raw, importo_source, codici_articolo, tags, note, versione_ingest, consegna_settimane_min, consegna_settimane_max, margine_trattativa_pct, created_at, updated_at"
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
      .select("id, sheet_name, codice_articolo, descrizione, quantita, prezzo_unitario, ricarico_pct, ricarico_coefficiente, tipo_riga, totale_riga, codice_blocco")
      .eq("documento_id", id)
      .order("sheet_name", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true }),
    sb
      .schema("preventivatore")
      .from("blocchi")
      .select("id, codice_blocco, sheet_name, totale_ceil_2, note, incluso_offerta, created_at, quantita_pezzi, imballaggio_pct, tempi_accessori_pct, spese_generali_pct, margine_trattativa_pct, costo_complessivo")
      .eq("documento_id", id)
      .order("created_at", { ascending: true }),
  ]);

  if (docRes.error) throw docRes.error;
  if (!docRes.data) notFound();
  if (chunksRes.error) throw chunksRes.error;
  if (righeRes.error) throw righeRes.error;
  if (blocchiRes.error) throw blocchiRes.error;

  // Enforce filtro commerciale ristretto sulla scheda dettaglio
  if (agenteCommerciale) {
    const cmId = (docRes.data as { cliente_master_id: string | null }).cliente_master_id;
    if (!cmId) {
      notFound();
    } else {
      const visibili = await getIdClientiVisibili(agenteCommerciale);
      if (!visibili.includes(cmId)) notFound();
    }
  }

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
    blocchi: (blocchiRes.data ?? []) as unknown as PreventivoBloccoRaw[],
    motivo_rifiuto_label: motivoRifiutoLabel,
  };

  return <DettaglioPreventivoView dettaglio={dettaglio} />;
}
