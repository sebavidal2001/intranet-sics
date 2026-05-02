"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Check, AlertCircle } from "lucide-react";
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
}: {
  utenteId: string;
  ruolo: RuoloProfessionale;
  inizialmenteAttivo: boolean;
  mansioniAssegnateIniziali: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [attivo, setAttivo] = useState(inizialmenteAttivo);
  const [espanso, setEspanso] = useState(inizialmenteAttivo);
  const [mansioniSelezionate, setMansioniSelezionate] = useState<string[]>(
    inizialmenteAttivo
      ? mansioniAssegnateIniziali
      : ruolo.mansioni.map((m) => m.id)
  );
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const toggleAttivo = (nuovoAttivo: boolean) => {
    setAttivo(nuovoAttivo);
    setEspanso(nuovoAttivo);
    if (nuovoAttivo) {
      // Pre-seleziona tutte le mansioni del ruolo
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

  const handleSalva = () => {
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
      setTimeout(() => setSaved(false), 2500);
      router.refresh();
    });
  };

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

        <span className="text-xs text-text-muted shrink-0">
          {ruolo.mansioni.length} mansioni
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
      {attivo && espanso && ruolo.mansioni.length > 0 && (
        <div className="border-t border-border">
          <div className="px-5 py-3 bg-bg-page border-b border-border">
            <p className="text-xs font-tenorite text-text-muted uppercase tracking-wide">
              Mansioni assegnate
            </p>
          </div>
          <div className="divide-y divide-border">
            {ruolo.mansioni.map((mansione) => {
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
            })}
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
          />
        );
      })}
    </div>
  );
}
