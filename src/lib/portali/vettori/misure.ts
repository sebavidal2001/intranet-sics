import { z } from "zod";
import type { RigaFattura } from "./fatture/tipi";
import type { Rilevazione } from "./letture";
import { nomiCompatibili, type SpedizioneLogica } from "./abbinamento";
import { normalizzaRiferimento } from "./fatture/testo";
import type { BollaMisura, DatiSpedizione, Vettore } from "./tipi";
import { pesoVolumetrico } from "./calcolo";

export const CONDIZIONI_CONTROLLO = ["bancale", "non_sovrapponibile", "movimentazione_manuale", "oversized", "ztl", "etichetta_manuale", "triangolazione", "fuori_provincia", "giacenza", "assegno"] as const;
export const MisureRiga = z.object({
  riga: z.number().int().positive(),
  direzione: z.enum(["entrata", "uscita"]).optional(),
  pesoKg: z.number().finite().positive().max(100000).optional(),
  volumeMc: z.number().finite().positive().max(1000).optional(),
  colli: z.array(z.object({ quantita: z.number().int().positive().max(999), lunghezzaCm: z.number().finite().positive().max(2000), larghezzaCm: z.number().finite().positive().max(2000), altezzaCm: z.number().finite().positive().max(2000) })).max(100).optional(),
  nonSovrapponibile: z.boolean().optional(),
  condizioni: z.array(z.enum(CONDIZIONI_CONTROLLO)).max(10).optional(),
}).refine((m) => !(m.volumeMc && m.colli?.length), "Inserire volume totale oppure misure dei colli, non entrambi.");
export const MisureFattura = z.array(MisureRiga).max(2000).refine((a) => new Set(a.map((m) => m.riga)).size === a.length, "Misure duplicate per la stessa riga.");
export type MisuraRiga = z.infer<typeof MisureRiga>;

const ValoriBollaMisura = z.object({
  quantita: z.number().int().positive().max(999),
  lunghezzaCm: z.number().finite().min(1).max(2000),
  larghezzaCm: z.number().finite().min(1).max(2000),
  altezzaCm: z.number().finite().min(1).max(2000),
  pesoRealeKg: z.number().finite().positive().max(100000).nullable().optional(),
});

export const MutazioneBollaMisura = z.discriminatedUnion("operazione", [
  ValoriBollaMisura.extend({
    operazione: z.literal("crea"),
    spedizioneId: z.string().uuid(),
  }),
  ValoriBollaMisura.extend({
    operazione: z.literal("aggiorna"),
    id: z.string().uuid(),
    spedizioneId: z.string().uuid(),
  }),
  z.object({
    operazione: z.literal("elimina"),
    id: z.string().uuid(),
    spedizioneId: z.string().uuid(),
  }),
]);

export type ValoriBollaMisuraInput = z.infer<typeof ValoriBollaMisura>;

export function volumeGruppoM3(misura: ValoriBollaMisuraInput): number {
  return (
    misura.quantita *
    misura.lunghezzaCm *
    misura.larghezzaCm *
    misura.altezzaCm
  ) / 1_000_000;
}

/** Associa i nomi/codici gestionali ai coefficienti contrattuali noti. */
export function divisoreVolumetricoBolla(
  vettoreCodice: string | null,
  vettoreNome: string | null,
  vettori: ReadonlyArray<
    Pick<Vettore, "codice" | "nome" | "divisoreVolumetrico">
  >
): number | null {
  const chiave = `${vettoreCodice ?? ""} ${vettoreNome ?? ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");

  const corrispondenti = vettori.filter((vettore) => {
    const codice = vettore.codice.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const nome = vettore.nome.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return (codice.length > 1 && chiave.includes(codice)) ||
      (nome.length > 1 && chiave.includes(nome));
  });
  const divisori = [...new Set(corrispondenti.map((vettore) => vettore.divisoreVolumetrico))];
  return divisori.length === 1 ? divisori[0] : null;
}

/**
 * Riepilogo usato dalla bolla mentre l'operatore digita. Il calcolo del peso
 * passa dal motore vettori esistente; se il gestionale ha già un volume, quel
 * valore ha precedenza sulle misure manuali.
 */
export function riepilogoMisureBolla(
  misure: ReadonlyArray<
    Pick<BollaMisura, "quantita" | "lunghezzaCm" | "larghezzaCm" | "altezzaCm">
  >,
  divisoreKgM3: number | null,
  volumeGestionaleM3: number | null
): {
  volumeM3: number;
  pesoVolumetricoKg: number | null;
  usaVolumeGestionale: boolean;
} {
  const usaVolumeGestionale =
    volumeGestionaleM3 !== null && volumeGestionaleM3 > 0;
  const volumeM3 = usaVolumeGestionale
    ? volumeGestionaleM3
    : misure.reduce(
        (totale, misura) =>
          totale + volumeGruppoM3({ ...misura, pesoRealeKg: null }),
        0
      );

  const pesoVolumetricoKg = divisoreKgM3
    ? pesoVolumetrico(
        usaVolumeGestionale
          ? { colli: 1, pesoReale: 0, volumeMc: volumeM3 }
          : { colli: 1, pesoReale: 0, misureColli: [...misure] },
        divisoreKgM3
      )
    : null;

  return { volumeM3, pesoVolumetricoKg, usaVolumeGestionale };
}

export function datiFisici(riga: RigaFattura, sped: SpedizioneLogica | null | undefined, misure: MisuraRiga | undefined, rilevazioni: Rilevazione[], divisore: number): { dati: DatiSpedizione; fonte: string; note: string[] } {
  const candidati = riga.direzione === "entrata" ? rilevazioni.filter((r) =>
    riga.riferimento && normalizzaRiferimento(r.numero_bolla ?? "") === normalizzaRiferimento(riga.riferimento) &&
    nomiCompatibili(r.fornitore_testo, sped?.controparte ?? riga.controparte) &&
    riga.data && Math.abs(Date.parse(r.data_arrivo) - Date.parse(riga.data)) <= 7 * 86400000
  ) : [];
  const rilevata = candidati.length === 1 ? candidati[0] : undefined;
  const colliMisurati = misure?.volumeMc ? undefined : misure?.colli?.length ? misure.colli : rilevata?.lunghezza_cm && rilevata.larghezza_cm && rilevata.altezza_cm ? [{ quantita: rilevata.colli, lunghezzaCm: rilevata.lunghezza_cm, larghezzaCm: rilevata.larghezza_cm, altezzaCm: rilevata.altezza_cm }] : undefined;
  const volumeBolla = sped?.volumeMc && sped.volumeMc > 0 ? sped.volumeMc : null;
  const volumeFattura = Number(riga.dettaglio.volumeMc) > 0 ? Number(riga.dettaglio.volumeMc) : null;
  const volume = misure?.volumeMc ?? (colliMisurati ? null : volumeBolla ?? volumeFattura ?? (riga.pesoVolumetrico && riga.pesoVolumetrico > 0 ? riga.pesoVolumetrico / divisore : null));
  const fonte = misure?.colli?.length || misure?.volumeMc ? "Misure inserite nel controllo" : colliMisurati ? "Misure di magazzino" : volumeBolla ? "Volume della bolla" : volumeFattura ? "Volume dichiarato in fattura" : volume ? "Peso volumetrico dichiarato dal vettore" : "Misure mancanti";
  return { fonte, note: [
    ...(candidati.length > 1 ? ["Più rilevazioni compatibili: inserire le misure corrette nel controllo."] : []),
    ...(fonte.includes("fattura") || fonte.includes("vettore") ? ["Dato dichiarato dal vettore: inserire le misure per verificare indipendentemente il peso volumetrico."] : []),
  ], dati: {
    colli: colliMisurati?.reduce((s, c) => s + c.quantita, 0) ?? rilevata?.colli ?? riga.colli ?? sped?.colli ?? 1,
    pesoReale: misure?.pesoKg ?? rilevata?.peso_kg ?? sped?.peso ?? riga.peso ?? riga.pesoTassato ?? 0,
    volumeMc: volume, misureColli: colliMisurati,
    condizioni: [...(misure?.condizioni ?? rilevata?.condizioni ?? []).filter((c) => misure?.nonSovrapponibile === undefined || c !== "non_sovrapponibile"), ...(misure?.nonSovrapponibile ? ["non_sovrapponibile"] : [])] as DatiSpedizione["condizioni"],
  } };
}
