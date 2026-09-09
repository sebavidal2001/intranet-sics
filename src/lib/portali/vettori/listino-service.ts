import { createAdminClient } from "@/lib/supabase/admin";
import type { Fascia, ListinoRisolto, Supplemento, Vettore } from "./tipi";

/**
 * Risoluzione del listino di un vettore a una certa data e per una certa zona.
 *
 * "A una certa data" non è un dettaglio: il controllo di un mese passato deve
 * usare il listino che valeva allora, non quello di oggi. Per questo la data è
 * un parametro obbligatorio e non ha un valore di ripiego a `now()`.
 */

const SCHEMA = "vettori";

interface RigaVettore {
  id: string;
  codice: string;
  nome: string;
  modello_tariffa: "scaglioni" | "quintale";
  divisore_volumetrico: number;
  peso_minimo_tassabile: number;
  arrotondamento_kg: number;
  arrotondamento_da_kg: number;
  attivo: boolean;
  a_nostro_carico: boolean;
}

export interface ZonaVettore {
  id: string;
  codice: string;
  nome: string;
  isDefault: boolean;
  province: string[];
}

export interface EsitoZona {
  zona: ZonaVettore | null;
  /** Perché il vettore non copre quella destinazione, quando `zona` è null. */
  motivo?: string;
}

function mapVettore(r: RigaVettore): Vettore {
  return {
    id: r.id,
    codice: r.codice,
    nome: r.nome,
    modelloTariffa: r.modello_tariffa,
    divisoreVolumetrico: Number(r.divisore_volumetrico),
    pesoMinimoTassabile: Number(r.peso_minimo_tassabile),
    arrotondamentoKg: Number(r.arrotondamento_kg),
    arrotondamentoDaKg: Number(r.arrotondamento_da_kg),
  };
}

/** I vettori che ci fatturano, cioè quelli su cui ha senso fare un controllo. */
export async function elencoVettori(soloNostri = true): Promise<
  Array<Vettore & { attivo: boolean; aNostroCarico: boolean }>
> {
  const admin = createAdminClient();
  let q = admin
    .schema(SCHEMA)
    .from("vettori")
    .select(
      "id, codice, nome, modello_tariffa, divisore_volumetrico, peso_minimo_tassabile, arrotondamento_kg, arrotondamento_da_kg, attivo, a_nostro_carico"
    )
    .eq("attivo", true)
    .order("nome");
  if (soloNostri) q = q.eq("a_nostro_carico", true);

  const { data } = await q;
  return ((data ?? []) as RigaVettore[]).map((r) => ({
    ...mapVettore(r),
    attivo: r.attivo,
    aNostroCarico: r.a_nostro_carico,
  }));
}

/**
 * Zone di un vettore con le province coperte.
 */
export async function zoneVettore(vettoreId: string): Promise<ZonaVettore[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .schema(SCHEMA)
    .from("zone")
    .select("id, codice, nome, is_default, ordine, zone_province(provincia)")
    .eq("vettore_id", vettoreId)
    .order("ordine");

  if (error) throw new Error(`Lettura zone fallita: ${error.message}`);
  return ((data ?? []) as unknown as Array<{
    id: string;
    codice: string;
    nome: string;
    is_default: boolean;
    zone_province: Array<{ provincia: string }> | null;
  }>).map((z) => ({
    id: z.id,
    codice: z.codice,
    nome: z.nome,
    isDefault: z.is_default,
    province: (z.zone_province ?? []).map((p) => p.provincia.toUpperCase()),
  }));
}

/**
 * Trova la zona tariffaria per una provincia.
 *
 * Restituisce un esito, non `null` secco: se il vettore non copre quella
 * destinazione la simulazione deve poterlo dire con il motivo, invece di
 * calcolare un prezzo che non esiste. Trading Post, per esempio, non esce da
 * Emilia, Lombardia e Piemonte e non ha zona di ripiego.
 */
export function risolviZona(zone: ZonaVettore[], provincia: string | null): EsitoZona {
  const sigla = (provincia ?? "").trim().toUpperCase();
  // Le fatture Trading Post usano ancora FO per Forlì/Bertinoro; il listino usa FC.
  const pv = sigla === "FO" ? "FC" : sigla;
  if (!pv) {
    const def = zone.find((z) => z.isDefault);
    return def
      ? { zona: def }
      : { zona: null, motivo: "Provincia non indicata e nessuna zona predefinita." };
  }
  const esatta = zone.find((z) => z.province.includes(pv));
  if (esatta) return { zona: esatta };

  const def = zone.find((z) => z.isDefault);
  if (def) return { zona: def };

  return {
    zona: null,
    motivo: `Destinazione ${pv} non coperta: il vettore serve solo ${zone
      .map((z) => z.nome)
      .join(", ")}.`,
  };
}

/**
 * Carica il listino di un vettore valido alla data indicata, già risolto sulla
 * zona, con adeguamento e carburante del mese.
 *
 * `null` quando per quella data non esiste un listino: meglio non rispondere
 * che rispondere con quello sbagliato.
 */
export async function risolviListino(params: {
  vettoreId: string;
  data: Date;
  provincia: string | null;
}): Promise<{ listino: ListinoRisolto | null; motivo?: string }> {
  const admin = createAdminClient();
  const iso = params.data.toISOString().slice(0, 10);

  const { data: vRows, error: vError } = await admin
    .schema(SCHEMA)
    .from("vettori")
    .select(
      "id, codice, nome, modello_tariffa, divisore_volumetrico, peso_minimo_tassabile, arrotondamento_kg, arrotondamento_da_kg, attivo, a_nostro_carico"
    )
    .eq("id", params.vettoreId)
    .limit(1);

  if (vError) throw new Error(`Lettura vettore fallita: ${vError.message}`);
  const vRow = (vRows ?? [])[0] as RigaVettore | undefined;
  if (!vRow) return { listino: null, motivo: "Vettore non trovato." };
  const vettore = mapVettore(vRow);

  const zone = await zoneVettore(params.vettoreId);
  const esitoZona = risolviZona(zone, params.provincia);
  if (!esitoZona.zona) return { listino: null, motivo: esitoZona.motivo };

  // Listino valido alla data: `valido_al` nullo significa ancora in vigore.
  const { data: lRows, error: lError } = await admin
    .schema(SCHEMA)
    .from("listini")
    .select("id, etichetta, valido_dal, valido_al")
    .eq("vettore_id", params.vettoreId)
    .lte("valido_dal", iso)
    .or(`valido_al.is.null,valido_al.gte.${iso}`)
    .order("valido_dal", { ascending: false })
    .limit(1);

  if (lError) throw new Error(`Lettura listino fallita: ${lError.message}`);
  const listinoRow = (lRows ?? [])[0] as
    | { id: string; etichetta: string; valido_dal: string; valido_al: string | null }
    | undefined;
  if (!listinoRow) {
    return {
      listino: null,
      motivo: `Nessun listino ${vettore.nome} in vigore al ${iso}: va caricata la versione valida per quella data.`,
    };
  }

  const risultati =
    await Promise.all([
      admin
        .schema(SCHEMA)
        .from("listini_fasce")
        .select("peso_da, peso_a, importo, tipo, scatto_kg, scatto_importo")
        .eq("listino_id", listinoRow.id)
        .eq("zona_id", esitoZona.zona.id)
        .order("peso_da"),
      admin
        .schema(SCHEMA)
        .from("listini_supplementi")
        .select(
          "codice, nome, tipo_calcolo, valore, base_nolo, condizione, importo_minimo, importo_massimo, soglia_kg_da, soglia_kg_a"
        )
        .eq("listino_id", listinoRow.id)
        .order("ordine"),
      admin
        .schema(SCHEMA)
        .from("adeguamenti")
        .select("percentuale")
        .eq("vettore_id", params.vettoreId)
        .lte("valido_dal", iso)
        .or(`valido_al.is.null,valido_al.gte.${iso}`)
        .order("valido_dal", { ascending: false })
        .limit(1),
      admin
        .schema(SCHEMA)
        .from("carburante")
        .select("percentuale")
        .eq("vettore_id", params.vettoreId)
        .or(`anno.lt.${params.data.getUTCFullYear()},and(anno.eq.${params.data.getUTCFullYear()},mese.lte.${params.data.getUTCMonth() + 1})`)
        .order("anno", { ascending: false })
        .order("mese", { ascending: false })
        .limit(1),
    ]);

  for (const risultato of risultati) {
    if (risultato.error) throw new Error(`Lettura condizioni fallita: ${risultato.error.message}`);
  }
  const [{ data: fRows }, { data: sRows }, { data: aRows }, { data: cRows }] = risultati;

  const fasce: Fascia[] = ((fRows ?? []) as Array<Record<string, unknown>>).map((f) => ({
    pesoDa: Number(f.peso_da),
    pesoA: f.peso_a == null ? null : Number(f.peso_a),
    importo: Number(f.importo),
    tipo: f.tipo as "fisso" | "quintale",
    scattoKg: f.scatto_kg == null ? null : Number(f.scatto_kg),
    scattoImporto: f.scatto_importo == null ? null : Number(f.scatto_importo),
  }));

  const supplementi: Supplemento[] = ((sRows ?? []) as Array<Record<string, unknown>>).map(
    (s) => ({
      codice: String(s.codice),
      nome: String(s.nome),
      tipoCalcolo: s.tipo_calcolo as Supplemento["tipoCalcolo"],
      valore: Number(s.valore),
      baseNolo: Boolean(s.base_nolo),
      condizione: s.condizione as Supplemento["condizione"],
      importoMinimo: s.importo_minimo == null ? null : Number(s.importo_minimo),
      importoMassimo: s.importo_massimo == null ? null : Number(s.importo_massimo),
      sogliaKgDa: s.soglia_kg_da == null ? null : Number(s.soglia_kg_da),
      sogliaKgA: s.soglia_kg_a == null ? null : Number(s.soglia_kg_a),
    })
  );

  const adeg = (aRows ?? [])[0] as { percentuale: number } | undefined;
  const carb = (cRows ?? [])[0] as { percentuale: number } | undefined;

  return {
    listino: {
      vettore,
      zonaCodice: esitoZona.zona.codice,
      fasce,
      supplementi,
      adeguamento: adeg ? Number(adeg.percentuale) : null,
      carburante: carb ? Number(carb.percentuale) : vettore.codice === "trading_post" ? 0 : null,
    },
  };
}

/** Etichetta e periodo del listino, per mostrarli accanto al risultato. */
export interface DescrizioneListino {
  id: string;
  etichetta: string;
  validoDal: string;
  validoAl: string | null;
}

export async function descriviListino(
  vettoreId: string,
  data: Date
): Promise<DescrizioneListino | null> {
  const admin = createAdminClient();
  const iso = data.toISOString().slice(0, 10);
  const { data: rows, error } = await admin
    .schema(SCHEMA)
    .from("listini")
    .select("id, etichetta, valido_dal, valido_al")
    .eq("vettore_id", vettoreId)
    .lte("valido_dal", iso)
    .or(`valido_al.is.null,valido_al.gte.${iso}`)
    .order("valido_dal", { ascending: false })
    .limit(1);
  if (error) throw new Error(`Lettura descrizione listino fallita: ${error.message}`);
  const r = (rows ?? [])[0] as
    | { id: string; etichetta: string; valido_dal: string; valido_al: string | null }
    | undefined;
  return r
    ? { id: r.id, etichetta: r.etichetta, validoDal: r.valido_dal, validoAl: r.valido_al }
    : null;
}
