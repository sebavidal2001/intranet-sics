import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireVettori } from "@/lib/portali/vettori/api-guard";
import { determinaProvincia, risolviCap } from "@/lib/portali/vettori/cap";
import { calcolaCostoAtteso } from "@/lib/portali/vettori/calcolo";
import {
  descriviListino,
  elencoVettori,
  risolviListino,
} from "@/lib/portali/vettori/listino-service";
import {
  calcolaMargineRiaddebito,
  calcolaRiaddebito,
  caricaAccordoRiaddebito,
  caricaVersioneRiaddebito,
} from "@/lib/portali/vettori/riaddebito";
import type {
  CondizioneSpedizione,
  EsitoSimulazione,
  RispostaSimulazione,
} from "@/lib/portali/vettori/tipi";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

const CONDIZIONI = [
  "bancale",
  "non_sovrapponibile",
  "movimentazione_manuale",
  "oversized",
  "ztl",
  "etichetta_manuale",
  "triangolazione",
  "fuori_provincia",
  "giacenza",
  "assegno",
] as const;

const Gruppo = z.object({
  quantita: z.number().int().min(1).max(999),
  lunghezzaCm: z.number().positive().max(2000),
  larghezzaCm: z.number().positive().max(2000),
  altezzaCm: z.number().positive().max(2000),
  pesoRealeKg: z.number().positive().max(100_000).nullable().optional(),
}).strict();

const Body = z.object({
  direzione: z.enum(["entrata", "uscita"]).default("uscita"),
  cap: z.string().trim().regex(/^\d{5}$/).nullable().optional(),
  provincia: z.string().trim().regex(/^[A-Za-z]{2}$/).nullable().optional(),
  controparteCodice: z.string().trim().min(1).max(100).nullable().optional(),
  colli: z.number().int().min(1).max(999),
  pesoKg: z.number().positive().max(100_000),
  gruppi: z.array(Gruppo).max(999).default([]),
  lunghezzaCm: z.number().positive().max(2000).nullable().optional(),
  larghezzaCm: z.number().positive().max(2000).nullable().optional(),
  altezzaCm: z.number().positive().max(2000).nullable().optional(),
  data: z.string().date().optional(),
  condizioni: z.array(z.enum(CONDIZIONI)).max(CONDIZIONI.length).default([]),
}).strict();

function euro(valore: number): number {
  return Math.round((valore + Number.EPSILON) * 100) / 100;
}

function dataOggi(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Calcola il costo pieno su tutti i vettori a nostro carico senza creare dati.
 * Chi non copre la destinazione resta nell'elenco con il motivo: anche una
 * soluzione scartata e' parte della decisione che l'operatore deve poter vedere.
 */
export async function POST(request: NextRequest) {
  try {
    const guard = await requireVettori();
    if (!guard.ok) return guard.response;

    let corpo: unknown;
    try {
      corpo = await request.json();
    } catch {
      return NextResponse.json({ error: "Corpo della richiesta non valido." }, { status: 400 });
    }
    const parsed = Body.safeParse(corpo);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dati non validi.", dettagli: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const input = parsed.data;
    const colliNeiGruppi = input.gruppi.reduce((totale, gruppo) => totale + gruppo.quantita, 0);
    if (input.gruppi.length > 0 && colliNeiGruppi !== input.colli) {
      return NextResponse.json(
        {
          error: `I colli dichiarati sono ${input.colli}, ma la somma delle quantita dei gruppi e ${colliNeiGruppi}.`,
        },
        { status: 400 }
      );
    }

    const dataIso = input.data ?? dataOggi();
    const data = new Date(`${dataIso}T12:00:00Z`);
    const cap = input.cap ?? null;
    const esitoCapRisolto = cap ? await risolviCap(cap) : null;
    // Anche l'assenza di risultato deve arrivare al form come caso da chiarire,
    // non confondersi con una simulazione in cui il CAP non era stato inserito.
    const esitoCap = cap && !esitoCapRisolto
      ? { cap, province: [], comuni: [], fonte: "sconosciuta", certo: false, estero: false }
      : esitoCapRisolto;
    const destinazione = cap
      ? determinaProvincia(esitoCap, input.provincia)
      : determinaProvincia(null, input.provincia);

    const vettori = await elencoVettori(true);
    if (vettori.length === 0) {
      return NextResponse.json({ error: "Nessun vettore configurato." }, { status: 409 });
    }

    if (destinazione.estero) {
      const motivo = "destinazione internazionale, serve una quotazione a parte";
      const risposta: RispostaSimulazione = {
        data: dataIso,
        cap,
        provincia: null,
        fonteProvincia: null,
        risultati: vettori.map((vettore) => ({
          vettoreId: vettore.id,
          vettoreCodice: vettore.codice,
          vettoreNome: vettore.nome,
          disponibile: false,
          motivoIndisponibilita: motivo,
        })),
      };
      return NextResponse.json(risposta);
    }

    const [versioneRiaddebito, accordo] = await Promise.all([
      caricaVersioneRiaddebito(dataIso),
      caricaAccordoRiaddebito(input.controparteCodice, dataIso),
    ]);
    const dati = {
      colli: input.colli,
      pesoReale: input.pesoKg,
      misureColli: input.gruppi,
      lunghezzaCm: input.lunghezzaCm ?? null,
      larghezzaCm: input.larghezzaCm ?? null,
      altezzaCm: input.altezzaCm ?? null,
      condizioni: input.condizioni as CondizioneSpedizione[],
    };

    const risultati: EsitoSimulazione[] = await Promise.all(
      vettori.map(async (vettore): Promise<EsitoSimulazione> => {
        const { listino, motivo } = await risolviListino({
          vettoreId: vettore.id,
          data,
          provincia: destinazione.provincia,
        });
        if (!listino) {
          return {
            vettoreId: vettore.id,
            vettoreCodice: vettore.codice,
            vettoreNome: vettore.nome,
            disponibile: false,
            motivoIndisponibilita: motivo ?? "Listino non disponibile.",
          };
        }

        const calcolo = calcolaCostoAtteso(dati, listino);
        const senzaFascia = calcolo.totale === 0 && calcolo.nolo === 0;
        if (senzaFascia) {
          return {
            vettoreId: vettore.id,
            vettoreCodice: vettore.codice,
            vettoreNome: vettore.nome,
            disponibile: false,
            motivoIndisponibilita: calcolo.avvertenze[0] ?? "Fascia di peso non disponibile.",
            listino: await descriviListino(vettore.id, data),
            calcolo,
          };
        }

        const riaddebito = versioneRiaddebito
          ? calcolaRiaddebito({
              data: dataIso,
              pesoReale: input.pesoKg,
              pesoTassabile: calcolo.pesoTassabile,
              versione: versioneRiaddebito,
              accordo,
            })
          : undefined;
        return {
          vettoreId: vettore.id,
          vettoreCodice: vettore.codice,
          vettoreNome: vettore.nome,
          disponibile: true,
          listino: await descriviListino(vettore.id, data),
          calcolo,
          riaddebito,
          margine: riaddebito === undefined
            ? null
            : calcolaMargineRiaddebito(riaddebito, calcolo.totale),
        };
      })
    );

    const disponibili = risultati
      .filter((risultato) => risultato.disponibile && risultato.calcolo)
      .sort((a, b) => (a.calcolo?.totale ?? 0) - (b.calcolo?.totale ?? 0));
    const migliore = disponibili[0]?.calcolo?.totale;
    if (migliore !== undefined) {
      for (const risultato of disponibili) {
        risultato.differenzaDalMigliore = euro((risultato.calcolo?.totale ?? migliore) - migliore);
      }
    }

    const risposta: RispostaSimulazione = {
      data: dataIso,
      cap,
      provincia: destinazione.provincia,
      fonteProvincia: destinazione.fonteProvincia,
      capDaChiarire: destinazione.capDaChiarire,
      risultati: [
        ...disponibili,
        ...risultati.filter((risultato) => !risultato.disponibile),
      ],
    };
    return NextResponse.json(risposta);
  } catch (error) {
    logError("vettori.simula", "simulazione fallita", error);
    return NextResponse.json({ error: "Errore nella simulazione." }, { status: 500 });
  }
}
