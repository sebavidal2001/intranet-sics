"use client";

/**
 * Barre impilate: una colonna per periodo (o per la prima suddivisione), divisa
 * per la seconda. È il grafico di «portafoglio per mese diviso per business
 * unit»: il totale si legge dall'altezza, la composizione dai colori.
 *
 * Oltre otto voci le minori si sommano in «Altri»: una pila da venti colori
 * non si legge, e rifiutare il grafico lascerebbe l'utente con una tabella.
 */

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { propsAsseCategorie, propsAsseValori, propsLegenda, useImpostazioni } from "./impostazioni";
import { valoreFmt } from "./primitivi";
import type { RisultatoQuery } from "@/lib/prototipo-bi/tipi";

const MASSIMO_PILE = 8;
const ASSE = { fontSize: 11, fill: "#64748b" };

/** Asse e pila dalla forma della domanda; `null` se non c'e' una seconda dimensione. */
export function datiBarreImpilate(risultato: RisultatoQuery) {
  const raggruppa = risultato.spec.raggruppa ?? [];
  const temporale = Boolean(risultato.spec.granularita);
  const chiaveAsse = temporale ? "periodo" : raggruppa[0];
  const chiavePila = temporale ? raggruppa[0] : raggruppa[1];
  if (!chiaveAsse || !chiavePila) return null;

  const totaliPila = new Map<string, number>();
  for (const r of risultato.righe) {
    const p = r.chiavi[chiavePila] ?? "";
    totaliPila.set(p, (totaliPila.get(p) ?? 0) + Math.abs(r.valore));
  }
  const ordinate = [...totaliPila.keys()].sort((a, b) => (totaliPila.get(b) ?? 0) - (totaliPila.get(a) ?? 0));
  const tenute = new Set(ordinate.length > MASSIMO_PILE ? ordinate.slice(0, MASSIMO_PILE - 1) : ordinate);
  const pile = [...ordinate.filter((p) => tenute.has(p)), ...(ordinate.length > tenute.size ? ["Altri"] : [])];

  const perAsse = new Map<string, Record<string, number | string>>();
  for (const r of risultato.righe) {
    const x = r.chiavi[chiaveAsse] ?? r.etichetta;
    const p = tenute.has(r.chiavi[chiavePila] ?? "") ? (r.chiavi[chiavePila] ?? "") : "Altri";
    const riga = perAsse.get(x) ?? { asse: x };
    riga[p] = ((riga[p] as number | undefined) ?? 0) + r.valore;
    perAsse.set(x, riga);
  }
  const righe = [...perAsse.values()];
  if (temporale) righe.sort((a, b) => String(a.asse).localeCompare(String(b.asse)));
  else {
    const totale = (r: Record<string, number | string>) =>
      pile.reduce((t, p) => t + ((r[p] as number | undefined) ?? 0), 0);
    righe.sort((a, b) => totale(b) - totale(a));
  }
  return { righe, pile };
}

export function BarreImpilate({
  risultato,
  altezza = 300,
  onClick,
}: {
  risultato: RisultatoQuery;
  altezza?: number;
  onClick?: (etichetta: string) => void;
}) {
  const { coloreNome, imp, durata, aspetto, legenda } = useImpostazioni();
  const dati = useMemo(() => datiBarreImpilate(risultato), [risultato]);
  if (!dati) return null;
  const fmt = (v: number) => valoreFmt(v, risultato.unita, imp.numeriCompatti);

  return (
    <ResponsiveContainer width="100%" height={altezza}>
      <BarChart data={dati.righe} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
        {imp.mostraGriglia && <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />}
        <XAxis dataKey="asse" tick={ASSE} minTickGap={12} {...propsAsseCategorie(aspetto)} />
        <YAxis tick={ASSE} tickFormatter={fmt} {...propsAsseValori(aspetto)} />
        <Tooltip formatter={(v) => fmt(Number(v))} />
        {legenda !== "nascosta" && <Legend {...propsLegenda(legenda)} />}
        {dati.pile.map((p, i) => (
          <Bar
            key={p}
            dataKey={p}
            stackId="pila"
            fill={p === "Altri" ? "#cbd5e1" : coloreNome(p, i)}
            animationDuration={durata}
            onClick={() => onClick?.(p)}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
