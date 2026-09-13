"use client";

import type { RisultatoQuery, RigaRisultato } from "@/lib/prototipo-bi/tipi";
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
import { Bullet, Heatmap, Pareto, Quadranti, Sparkline } from "./grafici-avanzati";
import { Anelli, AreeImpilate, Composizione, Imbuto } from "./grafici-spettacolari";
import { useImpostazioni } from "./impostazioni";

interface ProprietaGraficoDaRisultato {
  risultato: RisultatoQuery;
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
  onClickEtichetta,
}: ProprietaGraficoDaRisultato): JSX.Element {
  const { colore } = useImpostazioni();
  const tipoScelto = tipo ?? scegliGrafico(risultato).tipo;
  const applicabili = graficiPossibili(risultato);
  const colorePrincipale = colore(0) || PALETTE[0];

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
  }
}
