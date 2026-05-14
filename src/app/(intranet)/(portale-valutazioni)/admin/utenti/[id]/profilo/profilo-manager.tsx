"use client";

import { useState, useTransition, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Check, AlertCircle, Search, Save } from "lucide-react";
import { setUtenteProfiloWithMansioni } from "./actions";

// ─── Tipi ─────────────────────────────────────────────────────────────────────

interface Mansione {
  id: string;
  testo: string;
  ordine: number;
  parametro: { nome: string; colore: string } | null;
}

interface RuoloProfessionale {
  id: string;
  nome: string;
  descrizione: string | null;
  mansioni: Mansione[];
}

interface Props {
  utenteId: string;
  ruoli: RuoloProfessionale[];
  profiliAssegnati: string[]; // ruolo_professionale_id[]
  mansioniAssegnate: string[]; // mansione_id[]
}

// ─── Componente singolo ruolo ─────────────────────────────────────────────────

function RuoloCard({
  utenteId,
  ruolo,
  inizialmenteAttivo,
  mansioniAssegnateIniziali,
  saveTrigger,
  ricercaGlobale,
}: {
  utenteId: string;
  ruolo: RuoloProfessionale;
  inizialmenteAttivo: boolean;
  mansioniAssegnateIniziali: string[];
  saveTrigger: number;
  ricercaGlobale: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [attivo, setAttivo] = useState(inizialmenteAttivo);
  const [espanso, setEspanso] = useState(false); // collapsed di default
  const [mansioniSelezionate, setMansioniSelezionate] = useState<string[]>(
    inizialmenteAttivo
      ? mansioniAssegnateIniziali
      : ruolo.mansioni.map((m) => m.id)
  );
  const [ricercaLocale, setRicercaLocale] = useState("");
  const [saved, setSaved] = useState(false);

  // La ricerca attiva è quella globale (se presente) oppure quella locale
  const ricercaAttiva = ricercaGlobale || ricercaLocale;
  const [error, setError] = useState("");

  const handleSalva = useCallback(() => {
    setError("");
    setSaved(false);

    startTransition(async () => {
      const result = await setUtenteProfiloWithMansioni({
        utente_id: utenteId,
        ruolo_professionale_id: ruolo.id,
        mansioni_ids: attivo ? mansioniSelezionate : [],
        attivo,
      });

      if (result.error) {
        setError(result.error);
        return;
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 5000); // visibile 5s
      router.refresh();
    });
  }, [attivo, mansioniSelezionate, utenteId, ruolo.id, router]);

  // Salva tutto: reagisce al trigger del parent
  const prevTrigger = useRef(0);
  useEffect(() => {
    if (saveTrigger > 0 && saveTrigger !== prevTrigger.current) {
      prevTrigger.current = saveTrigger;
      if (attivo || inizialmenteAttivo) {
        handleSalva();
      }
    }
  }, [saveTrigger, handleSalva, attivo, inizialmenteAttivo]);

  const toggleAttivo = (nuovoAttivo: boolean) => {
    setAttivo(nuovoAttivo);
    setEspanso(nuovoAttivo);
    if (nuovoAttivo) {
      setMansioniSelezionate(ruolo.mansioni.map((m) => m.id));
    }
  };

  const toggleMansione = (mansioneId: string) => {
    setMansioniSelezionate((prev) =>
      prev.includes(mansioneId)
        ? prev.filter((id) => id !== mansioneId)
        : [...prev, mansioneId]
    );
  };

  // Auto-espandi se la ricerca globale trova mansioni in questo ruolo
  const matchGlobale = ricercaGlobale
    ? ruolo.mansioni.some((m) =>
        m.testo.toLowerCase().includes(ricercaGlobale.toLowerCase())
      )
    : false;
  const espansoEffettivo = espanso || matchGlobale;

  const mansioniFiltrate = ruolo.mansioni.filter((m) =>
    m.testo.toLowerCase().includes(ricercaAttiva.toLowerCase())
  );

  return (
    <div className="bg-bg rounded-xl border border-border overflow-hidden">
      {/* Header ruolo */}
      <div className="px-5 py-4 flex items-center gap-4">
        {/* Toggle attivo */}
        <button
          onClick={() => toggleAttivo(!attivo)}
          className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 ${
            attivo ? "bg-primary" : "bg-border"
          }`}
          aria-checked={attivo}
          role="switch"
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
              attivo ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>

        <div className="flex-1 min-w-0">
          <p className="font-tenorite text-text">{ruolo.nome}</p>
          {ruolo.descrizione && (
            <p className="text-xs text-text-muted mt-0.5 truncate">
              {ruolo.descrizione}
            </p>
          )}
        </div>

        {/* Badge mansioni selezionate / totale */}
        <span className="text-xs text-text-muted shrink-0">
          {attivo
            ? `${mansioniSelezionate.length}/${ruolo.mansioni.length} selezionate`
            : `${ruolo.mansioni.length} mansioni`}
        </span>

        {attivo && ruolo.mansioni.length > 0 && (
          <button
            onClick={() => setEspanso((v) => !v)}
            className="p-1.5 text-text-muted hover:text-primary rounded-lg transition-colors"
          >
            {espanso ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>
        )}
      </div>

      {/* Mansioni espanse */}
      {attivo && espansoEffettivo && ruolo.mansioni.length > 0 && (
        <div className="border-t border-border">
          {/* Barra ricerca + seleziona/deseleziona tutte */}
          <div className="px-5 py-3 bg-bg-page border-b border-border flex items-center gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
              <input
                type="text"
                placeholder={ricercaGlobale ? `Filtrando per "${ricercaGlobale}"…` : "Cerca mansione…"}
                value={ricercaLocale}
                onChange={(e) => setRicercaLocale(e.target.value)}
                disabled={!!ricercaGlobale}
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-border bg-bg text-text placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              />
            </div>
            <button
              onClick={() => setMansioniSelezionate(ruolo.mansioni.map((m) => m.id))}
              className="text-xs text-primary hover:text-primary-dark transition-colors shrink-0 font-medium"
            >
              Seleziona tutte
            </button>
            <span className="text-text-muted text-xs">·</span>
            <button
              onClick={() => setMansioniSelezionate([])}
              className="text-xs text-text-muted hover:text-danger transition-colors shrink-0"
            >
              Deseleziona tutte
            </button>
          </div>

          <div className="divide-y divide-border">
            {mansioniFiltrate.length === 0 ? (
              <p className="px-5 py-4 text-sm text-text-muted italic">
                Nessun risultato per &ldquo;{ricercaAttiva}&rdquo;
              </p>
            ) : (
              mansioniFiltrate.map((mansione) => {
                const selezionata = mansioniSelezionate.includes(mansione.id);
                return (
                  <label
                    key={mansione.id}
                    className="flex items-start gap-3 px-5 py-3 hover:bg-bg-page transition-colors cursor-pointer"
                  >
                    <div className="relative mt-0.5 shrink-0">
                      <input
                        type="checkbox"
                        checked={selezionata}
                        onChange={() => toggleMansione(mansione.id)}
                        className="sr-only"
                      />
                      <div
                        className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                          selezionata
                            ? "bg-primary border-primary"
                            : "border-border bg-bg"
                        }`}
                      >
                        {selezionata && (
                          <Check className="w-2.5 h-2.5 text-white" />
                        )}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-text leading-snug">
                        {mansione.testo}
                      </p>
                      {mansione.parametro && (
                        <div className="flex items-center gap-1.5 mt-1">
                          <div
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{
                              backgroundColor: mansione.parametro.colore,
                            }}
                          />
                          <span className="text-xs text-text-muted">
                            {mansione.parametro.nome}
                          </span>
                        </div>
                      )}
                    </div>
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Feedback e salva */}
      {(attivo || inizialmenteAttivo) && (
        <div className="px-5 py-3 border-t border-border flex items-center justify-between gap-3">
          <div className="flex-1">
            {error && (
              <div className="flex items-center gap-2 text-danger text-xs">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {error}
              </div>
            )}
            {saved && (
              <div className="flex items-center gap-2 text-success text-xs">
                <Check className="w-3.5 h-3.5 shrink-0" />
                Salvato
              </div>
            )}
          </div>
          <button
            onClick={handleSalva}
            disabled={isPending}
            className="px-4 py-1.5 text-sm bg-primary hover:bg-primary-dark text-white font-tenorite rounded-lg transition-colors disabled:opacity-50 shrink-0"
          >
            {isPending ? "Salvataggio…" : "Salva"}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Componente principale ────────────────────────────────────────────────────

export default function ProfiloManager({
  utenteId,
  ruoli,
  profiliAssegnati,
  mansioniAssegnate,
}: Props) {
  const [saveTrigger, setSaveTrigger] = useState(0);
  const [ricercaGlobale, setRicercaGlobale] = useState("");

  if (ruoli.length === 0) {
    return (
      <div className="bg-bg rounded-xl border border-border p-8 text-center">
        <p className="font-tenorite text-text mb-1">
          Nessun profilo professionale configurato
        </p>
        <p className="text-sm text-text-muted">
          Prima crea i profili professionali nella sezione{" "}
          <a
            href="/admin/config/profili"
            className="text-primary hover:text-primary-dark transition-colors"
          >
            Configurazione → Profili
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Barra globale ricerca + Salva tutto */}
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
          <input
            type="text"
            placeholder="Cerca mansione tra tutti i profili…"
            value={ricercaGlobale}
            onChange={(e) => setRicercaGlobale(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm rounded-xl border border-border bg-bg text-text placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors"
          />
          {ricercaGlobale && (
            <button
              onClick={() => setRicercaGlobale("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text transition-colors text-lg leading-none"
            >
              ×
            </button>
          )}
        </div>
        <button
          onClick={() => setSaveTrigger((v) => v + 1)}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-primary hover:bg-primary-dark text-white font-tenorite rounded-lg transition-colors shadow-sm shrink-0"
        >
          <Save className="w-4 h-4" />
          Salva tutto
        </button>
      </div>

      {ruoli.map((ruolo) => {
        const attivo = profiliAssegnati.includes(ruolo.id);
        const mansioniRuoloAssegnate = mansioniAssegnate.filter((mid) =>
          ruolo.mansioni.some((m) => m.id === mid)
        );

        return (
          <RuoloCard
            key={ruolo.id}
            utenteId={utenteId}
            ruolo={ruolo}
            inizialmenteAttivo={attivo}
            mansioniAssegnateIniziali={mansioniRuoloAssegnate}
            saveTrigger={saveTrigger}
            ricercaGlobale={ricercaGlobale}
          />
        );
      })}
    </div>
  );
}
