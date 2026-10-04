"use client";

import { useState } from "react";
import { STATO_INVIO_UI } from "@/lib/portali/campagne/stati";
import type { CampagnaDelCliente } from "@/lib/portali/campagne/tipi";
import { formattaData } from "./api-client";

/** Quante targhette si vedono prima di «+N»: poche, perche' le campagne cresceranno. */
export const TARGHETTE_VISIBILI = 3;

/**
 * Prima quelle scelte nel filtro (e' il motivo per cui il cliente e' nell'elenco), poi
 * quelle ancora in lavorazione, poi le ricevute dalla piu' recente.
 */
export function ordinaCampagneCliente(campagne: CampagnaDelCliente[]): CampagnaDelCliente[] {
  const peso = (k: CampagnaDelCliente) => (k.selezionata ? 0 : k.data === null ? 1 : 2);
  return [...campagne].sort((a, b) => peso(a) - peso(b) || (b.data ?? "").localeCompare(a.data ?? "") || a.codice.localeCompare(b.codice));
}

function Targhetta({ k }: { k: CampagnaDelCliente }) {
  const ricevuta = k.stato === "consegnata" || k.stato === "consegnata_banco";
  return (
    <span
      title={`${k.nome} · ${STATO_INVIO_UI[k.stato].etichetta}${k.data ? ` · ${formattaData(k.data)}` : ""}`}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-medium ${
        ricevuta ? "border-success/30 bg-success/10 text-success" : "border-warning/40 bg-warning/10 text-warning"
      } ${k.selezionata ? "ring-2 ring-primary ring-offset-1" : ""}`}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATO_INVIO_UI[k.stato].pallino }} aria-hidden />
      {k.codice}
      <span className="font-normal opacity-80">{k.data ? formattaData(k.data).slice(0, 5) : "in corso"}</span>
    </span>
  );
}

/**
 * Le campagne di un cliente: solo le prime {@link TARGHETTE_VISIBILI} (le scelte nel
 * filtro, poi le piu' recenti) e un «+N» che apre il resto. Cosi' la riga resta della
 * stessa altezza con 3 campagne come con 30.
 */
export function CampagneCliente({ campagne }: { campagne: CampagnaDelCliente[] }) {
  const [aperto, setAperto] = useState(false);
  if (campagne.length === 0) return <span className="text-xs text-text-muted">nessuna ancora</span>;

  const ordinate = ordinaCampagneCliente(campagne);
  const visibili = aperto ? ordinate : ordinate.slice(0, TARGHETTE_VISIBILI);
  const nascoste = ordinate.length - TARGHETTE_VISIBILI;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visibili.map((k) => (
        <Targhetta key={k.codice} k={k} />
      ))}
      {nascoste > 0 ? (
        <button
          type="button"
          onClick={() => setAperto((v) => !v)}
          aria-expanded={aperto}
          className="rounded-lg border border-border bg-white px-2 py-1 text-xs font-medium text-text-muted transition-colors hover:border-primary/50 hover:text-primary"
        >
          {aperto ? "meno" : `+${nascoste}`}
        </button>
      ) : null}
    </div>
  );
}
