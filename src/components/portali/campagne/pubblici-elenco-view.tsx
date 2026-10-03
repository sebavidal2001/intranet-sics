"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronRight, Info, Loader2, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Pubblico, PubblicoRiepilogo } from "@/lib/portali/campagne/tipi";
import { chiamaApi } from "./api-client";
import { Campo, Messaggio, Pannello, TitoloPagina, classeSelect } from "./ui";

const num = (n: number) => n.toLocaleString("it-IT");

/**
 * I pubblici delle campagne: lo standard (quello che ogni campagna nuova riceve) e gli
 * altri, costruiti per le campagne con un target diverso. Si crea un pubblico partendo
 * dallo standard o da zero, poi lo si rifinisce nella sua pagina.
 */
export function PubbliciElencoView({ iniziale }: { iniziale: PubblicoRiepilogo[] }) {
  const router = useRouter();
  const standard = iniziale.find((p) => p.standard);
  const [aperto, setAperto] = useState(false);
  const [nome, setNome] = useState("");
  const [descrizione, setDescrizione] = useState("");
  const [parti, setParti] = useState<"standard" | "vuoto">("standard");
  const [occupato, setOccupato] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  async function crea() {
    setOccupato(true);
    setErrore(null);
    const r = await chiamaApi<{ pubblico: Pubblico }>("/api/portali/campagne/pubblici", {
      corpo: {
        nome: nome.trim(),
        descrizione: descrizione.trim() || null,
        ...(parti === "standard" && standard ? { copia_da: standard.id } : {}),
      },
    });
    setOccupato(false);
    if (!r.ok) {
      setErrore(r.errore);
      return;
    }
    router.push(`/campagne/pubblico/${r.dati.pubblico.id}`);
  }

  return (
    <div className="mx-auto max-w-4xl">
      <TitoloPagina
        icona={Users}
        titolo="Pubblici"
        sottotitolo="A chi si rivolgono le campagne. Lo standard è il punto di partenza di ogni campagna nuova; per una campagna con un target diverso crei un altro pubblico e lo assegni a quella."
        azioni={
          <Button onClick={() => setAperto((a) => !a)}>
            <Plus className="h-4 w-4" /> Nuovo pubblico
          </Button>
        }
      />

      {aperto ? (
        <Pannello titolo="Nuovo pubblico" className="mb-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etichetta="Nome" aiuto="Lo vedrai nel menu quando crei una campagna.">
              <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} placeholder="Es. Costruttori del Nord" aria-label="Nome del nuovo pubblico" />
            </Campo>
            <Campo etichetta="Parti da" aiuto="Poi lo modifichi come vuoi: lo standard non cambia.">
              <select value={parti} onChange={(e) => setParti(e.target.value as "standard" | "vuoto")} className={classeSelect} aria-label="Da dove partire">
                <option value="standard">Una copia dello standard</option>
                <option value="vuoto">Vuoto (nessun commerciale scelto)</option>
              </select>
            </Campo>
            <div className="sm:col-span-2">
              <Campo etichetta="Descrizione" aiuto="Facoltativa.">
                <Input value={descrizione} onChange={(e) => setDescrizione(e.target.value)} maxLength={300} aria-label="Descrizione del nuovo pubblico" />
              </Campo>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button onClick={crea} disabled={occupato || !nome.trim()}>
              {occupato ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Crea e continua
            </Button>
            <Button variant="ghost" onClick={() => setAperto(false)} disabled={occupato}>
              Annulla
            </Button>
          </div>
          {errore ? <div className="mt-3"><Messaggio tipo="errore">{errore}</Messaggio></div> : null}
        </Pannello>
      ) : null}

      <ul className="space-y-3">
        {iniziale.map((p) => (
          <li key={p.id}>
            <Link
              href={`/campagne/pubblico/${p.id}`}
              className="group flex items-center gap-4 rounded-2xl border border-border bg-white px-5 py-4 shadow-[0_1px_2px_rgba(15,23,32,0.04)] transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,161,190,0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Users className="h-5 w-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-tenorite text-base font-bold text-text">{p.nome}</span>
                  {p.standard ? (
                    <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary-dark">Standard · predefinito</span>
                  ) : null}
                </span>
                <span className="mt-0.5 block truncate text-sm text-text-muted">
                  {p.descrizione || (p.agenti.length > 0 ? `Commerciali: ${p.agenti.join(", ")}` : "Nessun commerciale preso per intero")}
                  {p.clienti_extra.length > 0 ? ` · ${num(p.clienti_extra.length)} scelti a mano` : ""}
                </span>
              </span>
              <span className="hidden text-right sm:block">
                <span className="block font-tenorite text-2xl font-bold leading-none text-text">{num(p.raggiunti)}</span>
                <span className="mt-1 block text-xs text-text-muted">clienti</span>
              </span>
              <span className="hidden w-24 text-right text-xs text-text-muted sm:block">
                {p.campagne === 0 ? "nessuna campagna" : p.campagne === 1 ? "1 campagna" : `${p.campagne} campagne`}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-5 flex items-start gap-2 text-xs text-text-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Il pubblico si sceglie per ogni campagna dalla sua scheda. Modificarlo non cambia i destinatari già aggiunti alle campagne.
      </p>
    </div>
  );
}
