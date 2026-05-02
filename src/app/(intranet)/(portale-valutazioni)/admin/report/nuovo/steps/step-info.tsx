"use client";

export interface InfoState {
  nome: string;
  descrizione: string;
  visibilita_ruoli: string[];
  is_attivo: boolean;
}

interface Props {
  state: InfoState;
  ruoli: { slug: string; nome: string; colore: string }[];
  onChange: (s: InfoState) => void;
}

export function StepInfo({ state, ruoli, onChange }: Props) {
  const toggleRuolo = (slug: string) =>
    onChange({
      ...state,
      visibilita_ruoli: state.visibilita_ruoli.includes(slug)
        ? state.visibilita_ruoli.filter((r) => r !== slug)
        : [...state.visibilita_ruoli, slug],
    });

  return (
    <div className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-text mb-1.5">Nome report <span className="text-danger">*</span></label>
        <input
          value={state.nome}
          onChange={(e) => onChange({ ...state, nome: e.target.value })}
          placeholder="es. Report annuale 2024"
          className="w-full px-3 py-2 border border-border rounded-lg bg-bg text-text placeholder-text-muted focus:outline-none focus:border-primary"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-text mb-1.5">Descrizione</label>
        <textarea
          value={state.descrizione}
          onChange={(e) => onChange({ ...state, descrizione: e.target.value })}
          rows={3}
          placeholder="Descrizione opzionale..."
          className="w-full px-3 py-2 border border-border rounded-lg bg-bg text-text placeholder-text-muted focus:outline-none focus:border-primary resize-none"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-text mb-2">Visibilità per ruolo</label>
        <div className="flex flex-wrap gap-2">
          {ruoli.map((r) => (
            <button
              key={r.slug}
              type="button"
              onClick={() => toggleRuolo(r.slug)}
              className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                state.visibilita_ruoli.includes(r.slug)
                  ? "text-white"
                  : "bg-bg text-text-muted hover:border-primary"
              }`}
              style={state.visibilita_ruoli.includes(r.slug)
                ? { background: r.colore, borderColor: r.colore }
                : { borderColor: "#e2e8f0" }}
            >
              {r.nome}
            </button>
          ))}
        </div>
        {state.visibilita_ruoli.length === 0 && (
          <p className="text-xs text-warning mt-1.5">Nessun ruolo selezionato — il report non sarà visibile agli utenti.</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="is_attivo" checked={state.is_attivo}
          onChange={(e) => onChange({ ...state, is_attivo: e.target.checked })}
          className="w-4 h-4 accent-primary" />
        <label htmlFor="is_attivo" className="text-sm text-text">Attiva subito il report</label>
      </div>
    </div>
  );
}
