"use client";

import type {
  RisultatoQuery,
  RigaRisultato,
  SerieAnalisiEseguita,
  UnitaMisura,
} from "@/lib/prototipo-bi/tipi";
import {
  graficiPossibili,
  scegliGrafico,
  type TipoGrafico,
} from "@/lib/prototipo-bi/scelta-grafico";
import {
  GraficoBarre,
  GraficoCombo,
  GraficoLinee,
  GraficoTorta,
  KpiEroe,
  PALETTE,
  Tabella,
} from "./primitivi";
import {
  BarreScostamento,
  Bullet,
  Heatmap,
  Pareto,
  Quadranti,
  Sparkline,
} from "./grafici-avanzati";
import { Anelli, AreeImpilate, Composizione, Imbuto } from "./grafici-spettacolari";
import {
  Distribuzione,
  Flusso,
  Istogramma,
  Matrice,
  Pendenza,
  Posizioni,
} from "./grafici-nuovi";
import { useImpostazioni } from "./impostazioni";
import {
  TabellaAnalitica,
  type ColonnaAnalitica,
  type RigaAnalitica,
} from "./tabella-analitica";

interface ProprietaGraficoDaRisultato {
  risultato: RisultatoQuery;
  tipo?: TipoGrafico;
  altezza?: number;
  coloreSerie?: string;
  onClickEtichetta?: (etichetta: string) => void;
}

interface ProprietaGraficoDaAnalisi {
  serie: SerieAnalisiEseguita[];
  tipo?: TipoGrafico;
  altezza?: number;
  onClickEtichetta?: (etichetta: string) => void;
}

function datiSemplici(risultato: RisultatoQuery) {
  return risultato.righe.map(({ etichetta, valore }) => ({ etichetta, valore }));
}

function risultatoPerSerie(
  risultato: RisultatoQuery,
  righe: RigaRisultato[]
): RisultatoQuery {
  return {
    ...risultato,
    righe,
    totale: righe.reduce((somma, riga) => somma + riga.valore, 0),
  };
}

function serieTemporali(risultato: RisultatoQuery): { nome: string; risultato: RisultatoQuery }[] {
  const dimensione = risultato.spec.raggruppa?.[0];
  if (!dimensione) return [{ nome: risultato.metrica, risultato }];

  const totali = new Map<string, number>();
  for (const riga of risultato.righe) {
    const categoria = riga.chiavi[dimensione];
    totali.set(categoria, (totali.get(categoria) ?? 0) + riga.valore);
  }
  const categorie = [...totali.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([categoria]) => categoria);

  return categorie.map((categoria) => ({
    nome: categoria,
    risultato: risultatoPerSerie(
      risultato,
      risultato.righe
        .filter((riga) => riga.chiavi[dimensione] === categoria)
        .map((riga) => ({ ...riga, etichetta: riga.chiavi.periodo }))
    ),
  }));
}

function matrice(risultato: RisultatoQuery) {
  const dimensioni = risultato.spec.raggruppa ?? [];
  const chiaveRiga = dimensioni[0];
  const chiaveColonna = dimensioni[1] ?? (risultato.spec.granularita ? "periodo" : undefined);
  if (!chiaveRiga || !chiaveColonna) return null;

  const righe = [...new Set(risultato.righe.map((riga) => riga.chiavi[chiaveRiga]))];
  const colonne = [...new Set(risultato.righe.map((riga) => riga.chiavi[chiaveColonna]))];
  const valori: Record<string, Record<string, number>> = {};
  for (const riga of risultato.righe) {
    const nomeRiga = riga.chiavi[chiaveRiga];
    const nomeColonna = riga.chiavi[chiaveColonna];
    valori[nomeRiga] ??= {};
    valori[nomeRiga][nomeColonna] = (valori[nomeRiga][nomeColonna] ?? 0) + riga.valore;
  }
  return { righe, colonne, valori };
}

function aree(risultato: RisultatoQuery) {
  const dimensione = risultato.spec.raggruppa?.[0];
  if (!dimensione || !risultato.spec.granularita) return null;

  const periodi = [...new Set(risultato.righe.map((riga) => riga.chiavi.periodo))];
  const categorie = [...new Set(risultato.righe.map((riga) => riga.chiavi[dimensione]))];
  const serie = categorie.map((categoria) => {
    const valori: Record<string, number> = {};
    for (const riga of risultato.righe) {
      if (riga.chiavi[dimensione] === categoria) {
        const periodo = riga.chiavi.periodo;
        valori[periodo] = (valori[periodo] ?? 0) + riga.valore;
      }
    }
    return { nome: categoria, valori };
  });
  return { periodi, serie };
}

function valorePerEtichetta(risultato: RisultatoQuery): Map<string, number> {
  return new Map(risultato.righe.map((riga) => [riga.etichetta, riga.valore]));
}

function risultatoAllineatoNelTempo(voce: SerieAnalisiEseguita): RisultatoQuery {
  if (voce.spec.modificatore !== "anno_precedente" && voce.spec.modificatore !== "progressivo_ap") {
    return voce.risultato;
  }
  return {
    ...voce.risultato,
    righe: voce.risultato.righe.map((riga) => {
      const periodo = riga.chiavi.periodo;
      if (!/^\d{4}(?:-|$)/u.test(periodo ?? "")) return riga;
      const allineato = `${Number(periodo.slice(0, 4)) + 1}${periodo.slice(4)}`;
      return {
        ...riga,
        etichetta: riga.etichetta.replace(periodo, allineato),
        chiavi: { ...riga.chiavi, periodo: allineato },
      };
    }),
  };
}

function righeBullet(serie: SerieAnalisiEseguita[]) {
  const principale = serie.find((voce) => voce.ruolo === "principale");
  const obiettivo = serie.find((voce) => voce.ruolo === "obiettivo");
  const soglia = serie.find((voce) => voce.ruolo === "soglia");
  if (!principale || !obiettivo) return [];

  if (
    principale.risultato.righe.length === 1 &&
    (principale.risultato.spec.raggruppa?.length ?? 0) === 0
  ) {
    return [{
      etichetta: principale.nome,
      valore: principale.risultato.totale,
      obiettivo: obiettivo.risultato.totale,
      soglia: soglia?.risultato.totale,
    }];
  }

  const obiettivi = valorePerEtichetta(obiettivo.risultato);
  const soglie = soglia ? valorePerEtichetta(soglia.risultato) : new Map<string, number>();
  return principale.risultato.righe.map((riga) => ({
    etichetta: riga.etichetta,
    valore: riga.valore,
    obiettivo: obiettivi.get(riga.etichetta) ?? 0,
    soglia: soglie.get(riga.etichetta),
  }));
}

function tipoColonna(unita: UnitaMisura): ColonnaAnalitica["tipo"] {
  if (unita === "percentuale") return "percentuale";
  if (unita === "euro") return "euro";
  return "numero";
}

function chiaveCategoria(serie: SerieAnalisiEseguita, riga: RigaRisultato): string {
  const dimensione = serie.spec.raggruppa?.[0];
  return dimensione ? riga.chiavi[dimensione] ?? riga.etichetta : riga.etichetta;
}

function tabellaComposita(serie: SerieAnalisiEseguita[]) {
  const principale = serie.find((voce) => voce.ruolo === "principale") ?? serie[0];
  if (!principale) return { colonne: [], righe: [] };
  const nonTemporali = serie.filter((voce) => voce.spec.granularita === undefined);
  const fontiRighe = nonTemporali.length > 0 ? nonTemporali : [principale];
  const chiavi = new Set<string>();
  for (const voce of fontiRighe) {
    for (const riga of voce.risultato.righe) chiavi.add(chiaveCategoria(voce, riga));
  }

  const colonne: ColonnaAnalitica[] = nonTemporali.map((voce, indice) => ({
    chiave: `serie_${indice}`,
    etichetta: voce.nome,
    tipo: indice === 0 ? "barra" : tipoColonna(voce.risultato.unita),
    unita: voce.risultato.unita,
  }));
  const confronto = nonTemporali.find((voce) => voce.ruolo === "confronto");
  const obiettivo = nonTemporali.find((voce) => voce.ruolo === "obiettivo");
  if (confronto) {
    colonne.push({
      chiave: "delta_confronto",
      etichetta: "Delta",
      tipo: principale.risultato.unita === "euro" ? "delta_euro" : "numero",
      unita: principale.risultato.unita,
    });
  }
  if (obiettivo) {
    colonne.push({
      chiave: "raggiungimento",
      etichetta: "Raggiungimento",
      tipo: "raggiungimento",
    });
  }
  const temporale = serie.find(
    (voce) => voce.spec.granularita !== undefined && (voce.spec.raggruppa?.length ?? 0) > 0
  );
  if (temporale) {
    colonne.push({ chiave: "andamento", etichetta: "Andamento", tipo: "sparkline" });
  }

  const mappe = new Map<SerieAnalisiEseguita, Map<string, number>>();
  for (const voce of nonTemporali) {
    mappe.set(
      voce,
      new Map(voce.risultato.righe.map((riga) => [chiaveCategoria(voce, riga), riga.valore]))
    );
  }
  const righe: RigaAnalitica[] = [...chiavi].map((chiave) => {
    const celle: RigaAnalitica["celle"] = {};
    nonTemporali.forEach((voce, indice) => {
      celle[`serie_${indice}`] = mappe.get(voce)?.get(chiave) ?? 0;
    });
    const valorePrincipale = mappe.get(principale)?.get(chiave) ?? 0;
    if (confronto) {
      celle.delta_confronto = valorePrincipale - (mappe.get(confronto)?.get(chiave) ?? 0);
    }
    if (obiettivo) {
      const valoreObiettivo = mappe.get(obiettivo)?.get(chiave) ?? 0;
      celle.raggiungimento = valoreObiettivo === 0 ? null : (valorePrincipale / valoreObiettivo) * 100;
    }
    if (temporale) {
      celle.andamento = temporale.risultato.righe
        .filter((riga) => chiaveCategoria(temporale, riga) === chiave)
        .sort((a, b) => (a.chiavi.periodo ?? "").localeCompare(b.chiavi.periodo ?? ""))
        .map((riga) => riga.valore);
    }
    return { chiave, celle };
  });
  return { colonne, righe };
}

function matriceScostamento(serie: SerieAnalisiEseguita[]) {
  const principale = serie.find((voce) => voce.ruolo === "principale");
  const riferimento = serie.find((voce) => voce.ruolo === "obiettivo" || voce.ruolo === "confronto");
  if (!principale || !riferimento) return null;
  const dimensione = principale.spec.raggruppa?.[0];
  if (!dimensione || !principale.spec.granularita) return null;
  const righe = [...new Set(principale.risultato.righe.map((riga) => riga.chiavi[dimensione]))];
  const colonne = [...new Set(principale.risultato.righe.map((riga) => riga.chiavi.periodo))].sort();
  const mappaRiferimento = new Map(
    riferimento.risultato.righe.map((riga) => [
      `${riga.chiavi[dimensione]}|${riga.chiavi.periodo}`,
      riga.valore,
    ])
  );
  const valori: Record<string, Record<string, number>> = {};
  for (const nomeRiga of righe) valori[nomeRiga] = {};
  for (const riga of principale.risultato.righe) {
    const nomeRiga = riga.chiavi[dimensione];
    const colonna = riga.chiavi.periodo;
    const atteso = mappaRiferimento.get(`${nomeRiga}|${colonna}`) ?? 0;
    valori[nomeRiga][colonna] = atteso === 0 ? 0 : ((riga.valore - atteso) / Math.abs(atteso)) * 100;
  }
  return { righe, colonne, valori };
}

function Ripiego({ risultato, tipo }: { risultato: RisultatoQuery; tipo: TipoGrafico }) {
  return (
    <div className="space-y-3" role="status">
      <p className="text-sm text-text-muted">
        Il grafico «{tipo}» non è applicabile a questi dati. Mostro la tabella completa.
      </p>
      <Tabella risultato={risultato} massimo={risultato.righe.length || 15} />
    </div>
  );
}

export function GraficoDaRisultato({
  risultato,
  tipo,
  altezza = 300,
  coloreSerie,
  onClickEtichetta,
}: ProprietaGraficoDaRisultato): JSX.Element {
  const { colore } = useImpostazioni();
  const tipoScelto = tipo ?? scegliGrafico(risultato).tipo;
  const applicabili = graficiPossibili(risultato);
  const colorePrincipale = coloreSerie ?? (colore(0) || PALETTE[0]);

  if (!applicabili.includes(tipoScelto)) {
    return <Ripiego risultato={risultato} tipo={tipoScelto} />;
  }

  switch (tipoScelto) {
    case "barre":
      return (
        <GraficoBarre
          risultato={risultato}
          altezza={altezza}
          colore={colorePrincipale}
          onClick={onClickEtichetta}
        />
      );
    case "torta":
      return <GraficoTorta risultato={risultato} altezza={altezza} onClick={onClickEtichetta} />;
    case "linee":
      return (
        <GraficoLinee
          serie={serieTemporali(risultato).map((serie, indice) => ({
            ...serie,
            colore: colore(indice) || PALETTE[indice % PALETTE.length],
          }))}
          altezza={altezza}
        />
      );
    case "combo":
      return (
        <GraficoCombo
          barre={{ nome: risultato.metrica, risultato, colore: colorePrincipale }}
          linee={[{ nome: `${risultato.metrica} — andamento`, risultato, colore: colore(1) || PALETTE[1] }]}
          altezza={altezza}
        />
      );
    case "kpi": {
      const riga = risultato.righe[0];
      return <KpiEroe etichetta={riga.etichetta} valore={riga.valore} unita={risultato.unita} />;
    }
    case "tabella":
      return <Tabella risultato={risultato} massimo={risultato.righe.length || 15} />;
    case "pareto":
      return <Pareto dati={datiSemplici(risultato)} altezza={altezza} onClick={onClickEtichetta} />;
    case "heatmap": {
      const dati = matrice(risultato);
      if (!dati) return <Ripiego risultato={risultato} tipo={tipoScelto} />;
      return (
        <Heatmap
          {...dati}
          formato={risultato.unita === "percentuale" ? "percentuale" : "euro"}
          onClick={(riga) => onClickEtichetta?.(riga)}
        />
      );
    }
    case "quadranti":
      return (
        <Quadranti
          punti={risultato.righe.map((riga) => ({
            nome: riga.etichetta,
            x: riga.conteggio,
            y: riga.valore,
            dimensione: Math.abs(riga.valore),
          }))}
          etichettaX="Conteggio"
          etichettaY="Valore"
          altezza={altezza}
          onClick={onClickEtichetta}
        />
      );
    case "sparkline":
      return (
        <Sparkline
          valori={risultato.righe.map((riga) => riga.valore)}
          larghezza={Math.max(90, Math.min(320, altezza))}
          altezza={Math.min(80, altezza)}
          colore={colorePrincipale}
        />
      );
    case "treemap":
      return (
        <Composizione
          dati={datiSemplici(risultato)}
          unita={risultato.unita}
          altezza={altezza}
          onClick={onClickEtichetta}
        />
      );
    case "anelli": {
      const totale = risultato.totale;
      return (
        <Anelli
          voci={risultato.righe.map((riga) => ({
            etichetta: riga.etichetta,
            percentuale: totale === 0 ? 0 : (riga.valore / totale) * 100,
          }))}
          onClick={onClickEtichetta}
        />
      );
    }
    case "areeImpilate": {
      const dati = aree(risultato);
      if (!dati) return <Ripiego risultato={risultato} tipo={tipoScelto} />;
      return (
        <AreeImpilate
          {...dati}
          unita={risultato.unita}
          altezza={altezza}
          onClick={onClickEtichetta}
        />
      );
    }
    case "imbuto":
      return (
        <Imbuto
          fasi={datiSemplici(risultato)}
          unita={risultato.unita}
          altezza={altezza}
          onClick={onClickEtichetta}
        />
      );
    case "bullet":
      // RisultatoQuery non contiene un obiettivo: inventarne uno renderebbe il confronto ingannevole.
      void Bullet;
      return <Ripiego risultato={risultato} tipo={tipoScelto} />;

    // I sei tipi nuovi. `graficiPossibili` li ha gia' esclusi quando la forma
    // del dato non li regge — il controllo sopra e' passato — quindi qui si
    // disegna e basta: ognuno dichiara da se' cosa manca nei casi limite.
    case "matrice":
      return <Matrice risultato={risultato} altezza={altezza} onClick={onClickEtichetta} />;
    case "pendenza":
      return <Pendenza risultato={risultato} altezza={altezza} onClick={onClickEtichetta} />;
    case "distribuzione":
      return <Distribuzione risultato={risultato} altezza={altezza} onClick={onClickEtichetta} />;
    case "posizioni":
      return <Posizioni risultato={risultato} altezza={altezza} onClick={onClickEtichetta} />;
    case "flusso":
      return <Flusso risultato={risultato} altezza={altezza} onClick={onClickEtichetta} />;
    case "istogramma":
      return <Istogramma risultato={risultato} altezza={altezza} />;
  }
}

/**
 * La tinta di una serie: quella scelta a mano se c'è, altrimenti la palette.
 *
 * Il colore scelto conta soprattutto qui, dove le serie sono più di una:
 * affiancare ordinato, budget e BEP senza poter dire quale è quale lascia la
 * legenda come unico appiglio.
 */
function tintaSerie(
  voce: SerieAnalisiEseguita,
  indice: number,
  dallaPalette: (posizione: number) => string
): string {
  return voce.colore ?? (dallaPalette(indice) || PALETTE[indice % PALETTE.length]);
}

/** Distribuisce ruoli e risultati sulle firme già usate dai grafici del Cruscotto. */
export function GraficoDaAnalisi({
  serie,
  tipo,
  altezza = 300,
  onClickEtichetta,
}: ProprietaGraficoDaAnalisi): JSX.Element {
  const { colore } = useImpostazioni();
  const principale = serie.find((voce) => voce.ruolo === "principale") ?? serie[0];
  if (!principale) {
    return <p role="status" className="text-sm text-text-muted">Nessuna serie disponibile.</p>;
  }
  if (serie.length === 1) {
    return (
      <GraficoDaRisultato
        risultato={principale.risultato}
        tipo={tipo}
        altezza={altezza}
        coloreSerie={principale.colore}
        onClickEtichetta={onClickEtichetta}
      />
    );
  }

  const tipoScelto = tipo ?? scegliGrafico(serie).tipo;
  if (!graficiPossibili(serie).includes(tipoScelto)) {
    const dati = tabellaComposita(serie);
    return <TabellaAnalitica {...dati} colonnaDimensione="Voce" />;
  }

  switch (tipoScelto) {
    case "linee":
      return (
        <GraficoLinee
          serie={serie.map((voce, indice) => ({
            nome: voce.nome,
            risultato: risultatoAllineatoNelTempo(voce),
            colore: tintaSerie(voce, indice, colore),
            tratteggiata: voce.ruolo !== "principale",
          }))}
          altezza={altezza}
        />
      );
    case "combo":
      return (
        <GraficoCombo
          barre={{
            nome: principale.nome,
            risultato: principale.risultato,
            colore: tintaSerie(principale, 0, colore),
          }}
          linee={serie
            .filter((voce) => voce !== principale)
            .map((voce, indice) => ({
              nome: voce.nome,
              risultato: risultatoAllineatoNelTempo(voce),
              colore: tintaSerie(voce, indice + 1, colore),
              tratteggiata: voce.ruolo !== "principale",
            }))}
          altezza={altezza}
        />
      );
    case "bullet":
      return <Bullet righe={righeBullet(serie)} onClick={onClickEtichetta} />;
    case "barre": {
      const riferimento = serie.find(
        (voce) => voce.ruolo === "confronto" || voce.ruolo === "obiettivo"
      );
      if (!riferimento) {
        return <GraficoDaRisultato risultato={principale.risultato} tipo="barre" altezza={altezza} />;
      }
      const attesi = valorePerEtichetta(riferimento.risultato);
      return (
        <BarreScostamento
          dati={principale.risultato.righe.map((riga) => ({
            etichetta: riga.etichetta,
            valore: riga.valore - (attesi.get(riga.etichetta) ?? 0),
          }))}
          altezza={altezza}
          formato={principale.risultato.unita === "percentuale" ? "percentuale" : "euro"}
          onClick={onClickEtichetta}
        />
      );
    }
    case "kpi": {
      const confronto = serie.find((voce) => voce.ruolo === "confronto");
      const obiettivo = serie.find((voce) => voce.ruolo === "obiettivo");
      return (
        <KpiEroe
          etichetta={principale.nome}
          valore={principale.risultato.totale}
          unita={principale.risultato.unita}
          confronto={confronto ? { valore: confronto.risultato.totale, etichetta: confronto.nome } : null}
          nota={obiettivo ? `Obiettivo: ${obiettivo.nome}` : undefined}
        />
      );
    }
    case "quadranti": {
      const confronto = serie.find((voce) => voce.ruolo === "confronto");
      if (!confronto) return <GraficoDaRisultato risultato={principale.risultato} tipo="quadranti" />;
      const precedenti = valorePerEtichetta(confronto.risultato);
      return (
        <Quadranti
          punti={principale.risultato.righe.map((riga) => {
            const precedente = precedenti.get(riga.etichetta) ?? 0;
            return {
              nome: riga.etichetta,
              x: precedente,
              y: precedente === 0 ? 0 : ((riga.valore - precedente) / Math.abs(precedente)) * 100,
              dimensione: Math.abs(riga.valore),
            };
          })}
          etichettaX={confronto.nome}
          etichettaY="Variazione %"
          altezza={altezza}
          onClick={onClickEtichetta}
        />
      );
    }
    case "heatmap": {
      const dati = matriceScostamento(serie);
      if (!dati) return <GraficoDaRisultato risultato={principale.risultato} tipo="heatmap" />;
      return (
        <Heatmap
          {...dati}
          formato="percentuale"
          divergente
          onClick={(riga) => onClickEtichetta?.(riga)}
        />
      );
    }
    case "imbuto":
      return (
        <Imbuto
          fasi={serie.map((voce) => ({ etichetta: voce.nome, valore: voce.risultato.totale }))}
          unita={principale.risultato.unita}
          altezza={altezza}
          onClick={onClickEtichetta}
        />
      );
    case "treemap":
      return (
        <Composizione
          dati={serie.map((voce) => ({ etichetta: voce.nome, valore: voce.risultato.totale }))}
          unita={principale.risultato.unita}
          altezza={altezza}
          onClick={onClickEtichetta}
        />
      );
    case "areeImpilate": {
      const periodi = [...new Set(serie.flatMap((voce) =>
        voce.risultato.righe.map((riga) => riga.chiavi.periodo ?? riga.etichetta)
      ))].sort();
      return (
        <AreeImpilate
          periodi={periodi}
          serie={serie.map((voce) => ({
            nome: voce.nome,
            valori: Object.fromEntries(
              voce.risultato.righe.map((riga) => [riga.chiavi.periodo ?? riga.etichetta, riga.valore])
            ),
          }))}
          unita={principale.risultato.unita}
          altezza={altezza}
          onClick={onClickEtichetta}
        />
      );
    }
    case "tabella": {
      const dati = tabellaComposita(serie);
      return <TabellaAnalitica {...dati} colonnaDimensione="Voce" onClickRiga={onClickEtichetta} />;
    }
    default:
      return (
        <GraficoDaRisultato
          risultato={principale.risultato}
          tipo={tipoScelto}
          altezza={altezza}
          onClickEtichetta={onClickEtichetta}
        />
      );
  }
}
