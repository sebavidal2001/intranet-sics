/**
 * Visite dei commerciali.
 *
 * La fonte è `public.bi_visite` (migration 145): una riga per visita dal 2024,
 * estratta ogni notte da Impresa (`dba.visita`). Entrano nel motore come fatti
 * di un dataset a sé, come gli acquisti, così metriche, filtri, perimetro e
 * grafici funzionano senza codice dedicato.
 *
 * Tre limiti del gestionale che chi legge i grafici deve conoscere:
 *  · NIENTE ORA. Dentro una giornata le tappe si ordinano per id della visita,
 *    cioè per ordine di registrazione, che non è necessariamente l'ordine del
 *    giro. Una «rotta» è quindi una ricostruzione, non un tracciato.
 *  · NIENTE UTENTE. Il commerciale è il gruppo agenti della visita; chi l'ha
 *    inserita non è registrato.
 *  · NIENTE COORDINATE. Il punto sulla mappa è il centro del CAP (o, se il CAP
 *    non è noto, il capoluogo di provincia), non l'indirizzo.
 */

import type { RigaFatto } from "./tipi";

export interface RigaVisita {
  idVisita: number;
  data: string;
  codiceCliente: string;
  cliente: string;
  codiceAgente: string;
  agente: string;
  grado: string;
  tipo: string;
  cap: string;
  localita: string;
  provincia: string;
}

type Grezza = Record<string, unknown>;

const testo = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());

/** Una riga della vista `bi_visite` come visita normalizzata. */
export function daVista(g: Grezza): RigaVisita {
  return {
    idVisita: Number(g["id_visita"]) || 0,
    data: testo(g["data_visita"]).slice(0, 10),
    codiceCliente: testo(g["codice_cliente"]),
    cliente: testo(g["ragione_sociale"]),
    codiceAgente: testo(g["agente_codice"]),
    agente: testo(g["agente"]) || "(senza agente)",
    grado: testo(g["grado"]),
    tipo: testo(g["tipo"]),
    cap: testo(g["cap"]),
    localita: testo(g["localita"]),
    provincia: testo(g["provincia"]).toUpperCase(),
  };
}

/**
 * Le visite come fatti del motore.
 *
 * `documento` porta l'id della visita con zeri a sinistra: ordinato come testo
 * resta ordinato come numero, ed è l'unico ordine che il gestionale conserva
 * dentro una giornata.
 */
export function comeFatti(righe: RigaVisita[]): RigaFatto[] {
  return righe.map((r) => ({
    data: r.data,
    importo: 0,
    bu: "",
    categoria: r.tipo || "-",
    agente: r.agente,
    codiceAgente: r.codiceAgente,
    cliente: r.cliente,
    codiceCliente: r.codiceCliente,
    documento: String(r.idVisita).padStart(8, "0"),
    articolo: "",
    descrizioneArticolo: "",
    quantita: 1,
    cap: r.cap,
    localita: r.localita,
    provincia: r.provincia,
    grado: r.grado,
    tipoVisita: r.tipo,
  }));
}
