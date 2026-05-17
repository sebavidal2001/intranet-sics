"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, Check } from "lucide-react";
import type { PreventivoChunkRaw } from "./dettaglio-view-types";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  documentoId: string;
  codice: string | null;
  chunks: PreventivoChunkRaw[]; // chunks excel del documento
  importoCorrente: number | null;
  onSaved?: () => void;
}

interface CampoTotale {
  key: string;
  label: string;
  coeff?: boolean; // se true è un coefficiente ricarico (range 0-1)
}

const CAMPI: CampoTotale[] = [
  { key: "totale_materiale", label: "Totale materiale (post-ricarico)" },
  { key: "ricarico_materiale_coeff", label: "Coeff. ricarico materiale", coeff: true },
  { key: "totale_manodopera", label: "Totale manodopera (post-ricarico)" },
  { key: "ricarico_manodopera_coeff", label: "Coeff. ricarico manodopera", coeff: true },
  { key: "imballo", label: "Imballaggio" },
  { key: "tempi_accessori", label: "Tempi accessori" },
  { key: "spese_generali", label: "Spese generali" },
  { key: "variabili_progettuali", label: "Variabili progettuali" },
  { key: "totale_costi", label: "Totale costi" },
  { key: "totale", label: "Totale (pre-margine)" },
  { key: "margine_trattativa", label: "Margine trattativa (coeff. es. 0.08 = 8%)", coeff: true },
  { key: "prezzo_finale", label: "Prezzo finale" },
];

function readCurrentTotals(chunk: PreventivoChunkRaw): Record<string, string> {
  const t = chunk.metadata?.totals ?? {};
  const out: Record<string, string> = {};
  type V = { raw?: number; ceil_2?: number; coefficiente_raw?: number } | undefined;
  const num = (v: V) => (v?.ceil_2 ?? v?.raw ?? v?.coefficiente_raw ?? null);
  for (const c of CAMPI) {
    if (c.key === "ricarico_materiale_coeff") {
      out[c.key] = String(num(t.ricarico_materiale as V) ?? "");
    } else if (c.key === "ricarico_manodopera_coeff") {
      out[c.key] = String(num(t.ricarico_manodopera as V) ?? "");
    } else {
      out[c.key] = String(num((t as Record<string, V>)[c.key]) ?? "");
    }
  }
  return out;
}

export function CorreggiTotaliDialog({
  open,
  onOpenChange,
  documentoId,
  codice,
  chunks,
  importoCorrente,
  onSaved,
}: Props) {
  const excelChunks = chunks.filter((c) => c.metadata?.source_type === "excel");
  const [chunkIdx, setChunkIdx] = useState(0);
  const currentChunk = excelChunks[chunkIdx];
  const [valori, setValori] = useState<Record<string, string>>(
    currentChunk ? readCurrentTotals(currentChunk) : {}
  );
  const [importo, setImporto] = useState(importoCorrente != null ? String(importoCorrente) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const handleChangeChunk = (i: number) => {
    setChunkIdx(i);
    setValori(readCurrentTotals(excelChunks[i]));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setOk(false);
    try {
      const totalsPatch: Record<string, number | null> = {};
      for (const c of CAMPI) {
        const v = valori[c.key];
        if (v === "" || v == null) continue;
        const n = Number(v);
        if (!Number.isFinite(n)) {
          setError(`Valore non numerico in: ${c.label}`);
          setSaving(false);
          return;
        }
        totalsPatch[c.key] = n;
      }
      const body = {
        documento_id: documentoId,
        chunk_id: currentChunk?.id,
        totals_patch: totalsPatch,
        importo_preventivo: importo !== "" ? Number(importo) : undefined,
      };
      const res = await fetch("/api/portali/preventivatore/correzioni", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Errore salvataggio");
      setOk(true);
      onSaved?.();
      setTimeout(() => onOpenChange(false), 800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore di rete");
    } finally {
      setSaving(false);
    }
  };

  if (!currentChunk) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Correggi totali</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-text-muted">
            Nessun chunk Excel modificabile per questo documento.
          </p>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Correggi totali · {codice ?? ""}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {excelChunks.length > 1 && (
            <div className="flex gap-2 flex-wrap">
              {excelChunks.map((c, i) => (
                <button
                  key={c.id}
                  onClick={() => handleChangeChunk(i)}
                  className={`text-xs px-2.5 py-1.5 rounded-md border ${
                    i === chunkIdx
                      ? "border-[#00a1be] bg-[#00a1be]/10 text-[#007a91] font-medium"
                      : "border-border text-text-muted hover:border-[#00a1be]/40"
                  }`}
                >
                  {c.metadata?.sheet_name ?? `Blocco ${i + 1}`}
                </button>
              ))}
            </div>
          )}

          <div className="bg-bg-page rounded-lg p-3 border border-border">
            <p className="text-[11px] text-text-muted mb-2">
              Modifica i valori dei totali per il blocco selezionato. I valori precedenti vengono salvati come backup in <code>metadata.totals_originale</code> con audit utente/timestamp.
            </p>
            <p className="text-[11px] text-text-muted">
              Lascia un campo <strong>vuoto</strong> per rimuovere quel valore dai totals. I coefficienti ricarico sono numeri ≤ 1 (es. 0.5 = costo è 50% del prezzo finale).
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {CAMPI.map((c) => (
              <label key={c.key} className="text-sm">
                <span className="block text-xs text-text-muted mb-1">{c.label}</span>
                <input
                  type="number"
                  step={c.coeff ? "0.01" : "0.01"}
                  value={valori[c.key] ?? ""}
                  onChange={(e) => setValori({ ...valori, [c.key]: e.target.value })}
                  className="w-full border border-border rounded-md px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:border-[#00a1be]"
                />
              </label>
            ))}
          </div>

          <div className="border-t border-border pt-3">
            <label className="text-sm">
              <span className="block text-xs text-text-muted mb-1">
                Importo preventivo (documento, override prezzo finale)
              </span>
              <input
                type="number"
                step="0.01"
                value={importo}
                onChange={(e) => setImporto(e.target.value)}
                className="w-full border border-border rounded-md px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:border-[#00a1be]"
                placeholder="es. 5471.31"
              />
            </label>
          </div>

          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 rounded-md p-3 text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}
          {ok && (
            <div className="flex items-start gap-2 bg-green-50 border border-green-200 text-green-800 rounded-md p-3 text-sm">
              <Check className="w-4 h-4 mt-0.5 shrink-0" />
              Correzione salvata correttamente.
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Annulla
            </Button>
            <Button onClick={handleSave} disabled={saving} className="bg-[#00a1be] text-white hover:bg-[#007a91]">
              {saving ? <><Loader2 className="w-4 h-4 animate-spin mr-1" /> Salvo…</> : "Salva correzioni"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
