"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { ColorPicker } from "@/components/ui/color-picker";
import { FileDown, Plus, Trash2, ChevronDown } from "lucide-react";

const FONT_OPTIONS = [
  { value: "Helvetica", label: "Helvetica (Sans-serif)" },
  { value: "Times-Roman", label: "Times Roman (Serif)" },
  { value: "Courier", label: "Courier (Monospaced)" },
];

interface TitoloScheda {
  titolo: string;
  ruoli: string[];
}

interface RuoloOption {
  id: string;
  nome: string;
  slug: string;
  colore: string;
}

interface ConfigForm {
  codice_documento: string;
  data_edizione: string;
  data_aggiornamento: string;
  logo_url: string;
  font_corpo: string;
  orientamento: "portrait" | "landscape";
  mostra_radar: boolean;
  etichetta_area: string;
  etichetta_responsabile: string;
  etichetta_valutatore: string;
  etichetta_data_assunzione: string;
  etichetta_data_valutazione: string;
  etichetta_anzianita: string;
}

const DEFAULT_TITOLI: TitoloScheda[] = [
  { titolo: "Scheda di valutazione della prestazione del Personale", ruoli: ["collaboratore"] },
  { titolo: "Scheda di valutazione della prestazione dei Coordinatori", ruoli: ["responsabile_intermedio"] },
  { titolo: "Scheda di valutazione della prestazione dei Responsabili", ruoli: ["responsabile"] },
];

const FORM_DEFAULTS: ConfigForm = {
  codice_documento: "D.50-9 Rev 04",
  data_edizione: "",
  data_aggiornamento: "",
  logo_url: "",
  font_corpo: "Helvetica",
  orientamento: "portrait",
  mostra_radar: true,
  etichetta_area: "Area",
  etichetta_responsabile: "Responsabile",
  etichetta_valutatore: "Valutatore",
  etichetta_data_assunzione: "Data Assunzione",
  etichetta_data_valutazione: "Data Valutazione",
  etichetta_anzianita: "Anzianità",
};

async function loadConfig() {
  const res = await fetch("/api/portali/valutazioni/certificato-config", { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

async function loadRuoli(): Promise<RuoloOption[]> {
  const res = await fetch("/api/ruoli-config", { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

async function saveConfig(data: ConfigForm & {
  colore_primario: string;
  colore_testo: string;
  titoli_scheda: TitoloScheda[];
}): Promise<{ success: boolean; error?: string }> {
  const res = await fetch("/api/portali/valutazioni/certificato-config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { success: false, error: body.error ?? "Errore durante il salvataggio" };
  }
  return { success: true };
}

export default function ConfigCertificatoPage() {
  const [colore_primario, setColorePrimario] = useState("#00A1BE");
  const [colore_testo, setColoreTesto] = useState("#1A202C");
  const [titoli, setTitoli] = useState<TitoloScheda[]>(DEFAULT_TITOLI);
  const [ruoliOptions, setRuoliOptions] = useState<RuoloOption[]>([]);
  const [openDropdownIdx, setOpenDropdownIdx] = useState<number | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const { register, handleSubmit, reset } = useForm<ConfigForm>({
    defaultValues: FORM_DEFAULTS,
  });

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdownIdx(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    loadRuoli().then(setRuoliOptions);
    loadConfig().then((cfg) => {
      if (!cfg) return;
      const { titoli_scheda, colore_primario: cp, colore_testo: ct, ...rest } = cfg;
      reset({ ...FORM_DEFAULTS, ...rest });
      if (cp) setColorePrimario(cp);
      if (ct) setColoreTesto(ct);
      if (Array.isArray(titoli_scheda) && titoli_scheda.length > 0) setTitoli(titoli_scheda);
    });
  }, [reset]);

  // --- Titoli helpers ---
  const addTitolo = () =>
    setTitoli((prev) => [...prev, { titolo: "", ruoli: [] }]);

  const removeTitolo = (idx: number) =>
    setTitoli((prev) => prev.filter((_, i) => i !== idx));

  const updateTitoloText = (idx: number, value: string) =>
    setTitoli((prev) => prev.map((t, i) => (i === idx ? { ...t, titolo: value } : t)));

  const toggleRuolo = (idx: number, slug: string) =>
    setTitoli((prev) =>
      prev.map((t, i) => {
        if (i !== idx) return t;
        const ruoli = t.ruoli.includes(slug)
          ? t.ruoli.filter((r) => r !== slug)
          : [...t.ruoli, slug];
        return { ...t, ruoli };
      })
    );

  const onSubmit = (values: ConfigForm) => {
    setServerError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await saveConfig({ ...values, colore_primario, colore_testo, titoli_scheda: titoli });
      if (!result.success) {
        setServerError(result.error ?? "Errore");
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    });
  };

  const inputClass =
    "w-full border border-border rounded-lg px-3 py-2.5 text-sm text-text bg-bg placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors";
  const labelClass = "block font-tenorite text-sm text-text mb-1";

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Breadcrumbs items={[
        { label: "Config", href: "/admin/config" },
        { label: "Template certificato" },
      ]} />

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-tenorite text-2xl text-text">Template Certificato PDF</h1>
          <p className="text-text-muted text-sm mt-1">
            Personalizza l&apos;aspetto della scheda di valutazione generata come PDF.
          </p>
        </div>
        <a
          href="/api/portali/valutazioni/certificato/preview"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-tenorite text-text-muted hover:text-primary hover:border-primary transition-colors shrink-0"
        >
          <FileDown className="w-4 h-4" />
          Anteprima PDF
        </a>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {serverError && (
          <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg px-4 py-3 text-sm">
            {serverError}
          </div>
        )}
        {saved && (
          <div className="bg-success/10 border border-success/30 text-success rounded-lg px-4 py-3 text-sm">
            Configurazione salvata con successo.
          </div>
        )}

        {/* ── Titoli scheda ──────────────────────────────────── */}
        <div className="bg-bg rounded-xl border border-border p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-tenorite text-base text-text">Titoli scheda</h2>
              <p className="text-xs text-text-muted mt-0.5">
                Il titolo viene scelto in base al ruolo dell&apos;utente. Ogni titolo può essere assegnato a più ruoli.
              </p>
            </div>
            <button
              type="button"
              onClick={addTitolo}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm text-text-muted hover:text-primary hover:border-primary transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Aggiungi
            </button>
          </div>

          <div className="space-y-3">
            {titoli.map((titolo, idx) => (
              <div key={idx} className="rounded-lg border border-border p-4 space-y-3 bg-bg-page">
                <div className="flex items-start gap-2">
                  <input
                    type="text"
                    value={titolo.titolo}
                    onChange={(e) => updateTitoloText(idx, e.target.value)}
                    placeholder="Testo del titolo..."
                    className={inputClass + " flex-1"}
                  />
                  <button
                    type="button"
                    onClick={() => removeTitolo(idx)}
                    disabled={titoli.length === 1}
                    className="p-2.5 rounded-lg border border-border text-text-muted hover:text-danger hover:border-danger transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Dropdown ruoli */}
                <div className="relative" ref={openDropdownIdx === idx ? dropdownRef : undefined}>
                  <button
                    type="button"
                    onClick={() => setOpenDropdownIdx(openDropdownIdx === idx ? null : idx)}
                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs transition-colors ${
                      titolo.ruoli.length === 0
                        ? "border-warning/50 text-warning bg-warning/5"
                        : "border-border text-text bg-bg hover:border-primary"
                    }`}
                  >
                    <span>
                      {titolo.ruoli.length === 0
                        ? "Nessun ruolo — seleziona"
                        : titolo.ruoli.length === 1
                        ? ruoliOptions.find((r) => r.slug === titolo.ruoli[0])?.nome ?? "1 ruolo"
                        : `${titolo.ruoli.length} ruoli`}
                    </span>
                    <ChevronDown className={`w-3 h-3 transition-transform ${openDropdownIdx === idx ? "rotate-180" : ""}`} />
                  </button>

                  {openDropdownIdx === idx && (
                    <div className="absolute z-20 top-full left-0 mt-1 w-52 bg-bg border border-border rounded-lg shadow-lg py-1 max-h-60 overflow-y-auto">
                      {ruoliOptions.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-text-muted italic">Caricamento…</p>
                      ) : (
                        ruoliOptions.map((ruolo) => {
                          const checked = titolo.ruoli.includes(ruolo.slug);
                          return (
                            <label
                              key={ruolo.slug}
                              className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-bg-page cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleRuolo(idx, ruolo.slug)}
                                className="w-3.5 h-3.5 accent-primary cursor-pointer shrink-0"
                              />
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: ruolo.colore }}
                              />
                              <span className="text-xs text-text">{ruolo.nome}</span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Codice documento ──────────────────────────────── */}
        <div className="bg-bg rounded-xl border border-border p-6 space-y-4">
          <h2 className="font-tenorite text-base text-text">Riferimento documento</h2>
          <p className="text-xs text-text-muted -mt-2">
            Appare in alto a destra nell&apos;intestazione (es. &quot;D.50-9 Rev 04&quot;).
          </p>

          <div className="space-y-1.5">
            <label className={labelClass}>Codice documento</label>
            <input {...register("codice_documento")} type="text" placeholder="D.50-9 Rev 04" className={inputClass} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className={labelClass}>Data edizione</label>
              <input {...register("data_edizione")} type="text" placeholder="01/04/2026" className={inputClass} />
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>Ultimo aggiornamento</label>
              <input {...register("data_aggiornamento")} type="text" placeholder="01/04/2026" className={inputClass} />
            </div>
          </div>
        </div>

        {/* ── Logo ──────────────────────────────────────────── */}
        <div className="bg-bg rounded-xl border border-border p-6 space-y-4">
          <h2 className="font-tenorite text-base text-text">Logo</h2>
          <p className="text-xs text-text-muted -mt-2">
            Inserisci l&apos;URL pubblico del logo (es. da Supabase Storage). Lascia vuoto per usare il logo SICS predefinito.
          </p>
          <div className="space-y-1.5">
            <label className={labelClass}>URL Logo personalizzato</label>
            <input
              {...register("logo_url")}
              type="url"
              placeholder="https://... (lascia vuoto per logo SICS)"
              className={inputClass}
            />
          </div>
        </div>

        {/* ── Stile ─────────────────────────────────────────── */}
        <div className="bg-bg rounded-xl border border-border p-6 space-y-4">
          <h2 className="font-tenorite text-base text-text">Stile</h2>

          <div className="grid grid-cols-2 gap-4">
            <ColorPicker
              label="Colore principale"
              value={colore_primario}
              onChange={setColorePrimario}
            />
            <ColorPicker
              label="Colore testo"
              value={colore_testo}
              onChange={setColoreTesto}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className={labelClass}>Font</label>
              <select {...register("font_corpo")} className={inputClass}>
                {FONT_OPTIONS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>Orientamento</label>
              <select {...register("orientamento")} className={inputClass}>
                <option value="portrait">Verticale (A4 Portrait)</option>
                <option value="landscape">Orizzontale (A4 Landscape)</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <input
              {...register("mostra_radar")}
              type="checkbox"
              id="mostra_radar"
              className="w-4 h-4 rounded accent-primary cursor-pointer"
            />
            <label htmlFor="mostra_radar" className="text-sm text-text cursor-pointer select-none">
              Includi pagina radar competenze
            </label>
          </div>
        </div>

        {/* ── Etichette griglia info ────────────────────────── */}
        <div className="bg-bg rounded-xl border border-border p-6 space-y-4">
          <h2 className="font-tenorite text-base text-text">Etichette campi</h2>
          <p className="text-xs text-text-muted -mt-2">
            Modifica le label della griglia informazioni nella scheda.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className={labelClass}>Area / Reparto</label>
              <input {...register("etichetta_area")} type="text" className={inputClass} />
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>Responsabile</label>
              <input {...register("etichetta_responsabile")} type="text" className={inputClass} />
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>Valutatore</label>
              <input {...register("etichetta_valutatore")} type="text" className={inputClass} />
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>Data Assunzione</label>
              <input {...register("etichetta_data_assunzione")} type="text" className={inputClass} />
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>Data Valutazione</label>
              <input {...register("etichetta_data_valutazione")} type="text" className={inputClass} />
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>Anzianità</label>
              <input {...register("etichetta_anzianita")} type="text" className={inputClass} />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={isPending}
            className="bg-primary hover:bg-primary-dark text-white font-tenorite px-6 py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            {isPending ? "Salvataggio…" : "Salva configurazione"}
          </button>
        </div>
      </form>
    </div>
  );
}
