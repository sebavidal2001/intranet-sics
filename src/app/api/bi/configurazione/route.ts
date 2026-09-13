
import { NextRequest, NextResponse } from "next/server";
import { preliminari, errore, snapshotPerimetrato } from "../_comune";
import { leggiConfigurazione, salvaConfigurazione, anniConfigurati } from "@/lib/prototipo-bi/archivio";
import { configurazioneVuota, distribuisci, validaConfigurazione, budgetPerMese } from "@/lib/prototipo-bi/budget";
import type { ConfigurazioneAnno } from "@/lib/prototipo-bi/tipi";

export const dynamic = "force-dynamic";

function annoRichiesto(request: NextRequest): number {
  const p = request.nextUrl.searchParams.get("anno");
  const n = p ? Number(p) : new Date().getFullYear();
  return Number.isFinite(n) && n > 2000 && n < 2100 ? n : new Date().getFullYear();
}

/** Configurazione dell'anno + anteprima della distribuzione + valori suggeriti. */
export async function GET(request: NextRequest) {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;

  const anno = annoRichiesto(request);
  const config = (await leggiConfigurazione(anno)) ?? configurazioneVuota(anno);

  // Le BU e gli agenti si ricavano dai dati reali: non si digitano a mano.
  let buDisponibili: string[] = [];
  let agentiDisponibili: { codice: string; nome: string }[] = [];
  let incidenzeStoriche: { bu: string; pesoPct: number }[] = [];
  let quoteStoriche: { agente: string; quotaPct: number }[] = [];

  try {
    const snapshot = await snapshotPerimetrato(pre.accesso);
    const ordinato = snapshot.dataset.ordinato;
    const annoStorico = String(anno - 1);
    const storico = ordinato.filter((r) => r.data.startsWith(annoStorico));
    const base = storico.length > 0 ? storico : ordinato;

    const perBu = new Map<string, number>();
    const perAgente = new Map<string, { codice: string; importo: number }>();
    for (const r of base) {
      perBu.set(r.bu, (perBu.get(r.bu) ?? 0) + r.importo);
      const a = perAgente.get(r.agente) ?? { codice: r.codiceAgente, importo: 0 };
      a.importo += r.importo;
      perAgente.set(r.agente, a);
    }

    const totaleBu = [...perBu.values()].reduce((s, v) => s + v, 0);
    buDisponibili = [...perBu.keys()].sort();
    incidenzeStoriche = [...perBu.entries()]
      .map(([bu, v]) => ({ bu, pesoPct: totaleBu > 0 ? Math.round((v / totaleBu) * 1000) / 10 : 0 }))
      .sort((a, b) => b.pesoPct - a.pesoPct);

    const totaleAg = [...perAgente.values()].reduce((s, v) => s + v.importo, 0);
    agentiDisponibili = [...perAgente.entries()]
      .map(([nome, v]) => ({ codice: v.codice, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
    quoteStoriche = [...perAgente.entries()]
      .map(([agente, v]) => ({
        agente,
        quotaPct: totaleAg > 0 ? Math.round((v.importo / totaleAg) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.quotaPct - a.quotaPct);
  } catch {
    // Lo snapshot può mancare al primo avvio: la pagina funziona comunque.
  }

  const distribuzione = distribuisci(config);

  return NextResponse.json({
    config,
    anniConfigurati: await anniConfigurati(),
    avvisi: validaConfigurazione(config),
    anteprima: {
      giorniLavorativi: distribuzione.giorniLavorativi,
      budgetGiornaliero: distribuzione.budgetGiornaliero,
      bepGiornaliero: distribuzione.bepGiornaliero,
      perMese: [...budgetPerMese(distribuzione).entries()].map(([mese, v]) => ({
        mese,
        budget: v.budget,
        bep: v.bep,
        giorni: v.giorni,
      })),
      righeGenerate:
        distribuzione.giorni.length + distribuzione.perBU.length + distribuzione.perAgente.length,
    },
    suggerimenti: { buDisponibili, agentiDisponibili, incidenzeStoriche, quoteStoriche },
  });
}

/** Salva la configurazione (su file locale, MAI sul database). */
export async function POST(request: NextRequest) {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;

  let body: Partial<ConfigurazioneAnno>;
  try {
    body = await request.json();
  } catch {
    return errore("Body JSON non valido");
  }

  const anno = Number(body.anno);
  if (!Number.isFinite(anno) || anno < 2000 || anno > 2100) return errore("Anno non valido");

  const config: ConfigurazioneAnno = {
    anno,
    budgetAnnuo: Math.max(0, Number(body.budgetAnnuo ?? 0)),
    bepAnnuo: Math.max(0, Number(body.bepAnnuo ?? 0)),
    modalita: body.modalita === "lineare_mese" ? "lineare_mese" : "giorni_lavorativi",
    escludiWeekend: body.escludiWeekend !== false,
    chiusure: (body.chiusure ?? []).map((c, i) => ({
      id: c.id || `ch-${i}`,
      dal: String(c.dal ?? "").slice(0, 10),
      al: String(c.al ?? "").slice(0, 10),
      descrizione: String(c.descrizione ?? "Chiusura").slice(0, 120),
    })).filter((c) => c.dal && c.al),
    incidenzeBU: (body.incidenzeBU ?? [])
      .map((i) => ({ bu: String(i.bu ?? ""), pesoPct: Number(i.pesoPct ?? 0) }))
      .filter((i) => i.bu),
    commerciali: (body.commerciali ?? [])
      .map((c) => ({
        codiceAgente: String(c.codiceAgente ?? ""),
        agente: String(c.agente ?? ""),
        quotaPct: Number(c.quotaPct ?? 0),
        importoAnnuo:
          c.importoAnnuo === null || c.importoAnnuo === undefined || c.importoAnnuo === 0
            ? null
            : Number(c.importoAnnuo),
        bu: c.bu ? String(c.bu) : null,
      }))
      .filter((c) => c.agente),
    aggiornatoIl: new Date().toISOString(),
  };

  await salvaConfigurazione(config, pre.accesso.userId);
  const distribuzione = distribuisci(config);

  return NextResponse.json({
    ok: true,
    config,
    avvisi: distribuzione.avvisi,
    anteprima: {
      giorniLavorativi: distribuzione.giorniLavorativi,
      budgetGiornaliero: distribuzione.budgetGiornaliero,
      bepGiornaliero: distribuzione.bepGiornaliero,
      righeGenerate:
        distribuzione.giorni.length + distribuzione.perBU.length + distribuzione.perAgente.length,
    },
  });
}
