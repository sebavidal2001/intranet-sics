"use client";

import { useEffect, useState } from "react";
import { Loader2, Save, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const RUOLI_DEFINIZIONE: Array<{ slug: string; nome: string; descrizione: string; colore: string }> = [
  { slug: "commerciale",    nome: "Commerciale",    descrizione: "Apre richieste, vede SOLO i propri clienti (+AIRFLUID), flagga validazione economica", colore: "bg-blue-100 text-blue-800 border-blue-200" },
  { slug: "preventivatore", nome: "Preventivatore", descrizione: "Apre cartella, usa il builder, marca preventivo completato", colore: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  { slug: "back_office",    nome: "Back Office",    descrizione: "Inserisce numero offerta, importo finale, sceglie blocchi inclusi, marca inviata/ordinata/fallita", colore: "bg-amber-100 text-amber-800 border-amber-200" },
];

/**
 * Form superadmin per gestire i permessi preventivatore di un utente:
 *  - Ruoli funzionali (multi-select)
 *  - Codice agente del Cruscotto (per il filtro "io commerciale vedo i miei")
 */
export function PreventivatorePermessiUtente({ utenteId }: { utenteId: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [ruoliSlug, setRuoliSlug] = useState<string[]>([]);
  const [agenteCodice, setAgenteCodice] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/superadmin/preventivatore/permessi-utente/${utenteId}`)
      .then((r) => r.json())
      .then((d: { ruoli_slug?: string[]; agente_codice?: string | null }) => {
        if (!alive) return;
        setRuoliSlug(d.ruoli_slug ?? []);
        setAgenteCodice(d.agente_codice ?? "");
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [utenteId]);

  function toggleRuolo(slug: string) {
    setRuoliSlug((prev) => prev.includes(slug) ? prev.filter((x) => x !== slug) : [...prev, slug]);
    setSuccess(false);
  }

  async function salva() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch(`/api/superadmin/preventivatore/permessi-utente/${utenteId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ruoli_slug: ruoliSlug,
          agente_codice: agenteCodice.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Errore");
      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="text-sm text-text-muted py-4 flex items-center gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Caricamento permessi…
      </div>
    );
  }

  const isCommerciale = ruoliSlug.includes("commerciale");

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Ruoli funzionali Preventivatore</label>
        <div className="space-y-2">
          {RUOLI_DEFINIZIONE.map((r) => {
            const checked = ruoliSlug.includes(r.slug);
            return (
              <label
                key={r.slug}
                className={`flex items-start gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                  checked ? r.colore : "border-border hover:bg-bg-page"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleRuolo(r.slug)}
                  className="mt-0.5 accent-primary"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{r.nome}</div>
                  <div className="text-xs opacity-80">{r.descrizione}</div>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      <div>
        <label className="text-sm font-medium text-text mb-1 block">
          Codice agente Cruscotto
          {isCommerciale && <span className="text-xs text-danger ml-1">*</span>}
        </label>
        <Input
          value={agenteCodice}
          onChange={(e) => { setAgenteCodice(e.target.value); setSuccess(false); }}
          placeholder="es. AG010035"
          className="font-mono"
        />
        <p className="text-xs text-text-muted mt-1">
          Necessario per il filtro &ldquo;io commerciale vedo i miei clienti&rdquo;.
          {" "}I clienti con agente <span className="font-mono">AIRFLUID</span> sono sempre visibili.
          {" "}Lascia vuoto se l&apos;utente NON è un commerciale ristretto (vede tutto).
        </p>
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-border">
        <Button
          onClick={salva}
          disabled={saving || (isCommerciale && !agenteCodice.trim() && ruoliSlug.length > 0)}
          className="gap-1.5"
          style={{ backgroundColor: "#00a1be", color: "white" }}
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Salva permessi
        </Button>
        {success && (
          <span className="text-xs text-success flex items-center gap-1">
            <Check className="w-3 h-3" />
            Salvato
          </span>
        )}
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
    </div>
  );
}
