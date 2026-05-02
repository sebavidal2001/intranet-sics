"use client";

import { useState, useTransition, useRef } from "react";
import { Upload, AlertCircle, Check, Trash2 } from "lucide-react";
import { importStoricoPunteggi } from "./actions";

interface ParsedRow {
  utente_email: string;
  data_valutazione: string;
  punteggio: number;
  note?: string;
  _error?: string;
}

function parseDate(raw: string): string {
  // Handles DD/MM/YYYY and YYYY-MM-DD
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
    const [d, m, y] = trimmed.split("/");
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  throw new Error(`Formato data non riconosciuto: ${raw}`);
}

function parseCsv(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const colEmail = header.findIndex((h) => h.includes("email"));
  const colData = header.findIndex((h) => h.includes("data"));
  const colPunteggio = header.findIndex((h) => h.includes("punteggio"));
  const colNote = header.findIndex((h) => h.includes("note"));

  if (colEmail === -1 || colData === -1 || colPunteggio === -1) {
    return [{ utente_email: "", data_valutazione: "", punteggio: 0, _error: "Colonne mancanti: email_dipendente, data_valutazione, punteggio" }];
  }

  return lines.slice(1).map((line) => {
    const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    try {
      const punteggio = parseFloat(cols[colPunteggio]);
      if (isNaN(punteggio)) throw new Error("Punteggio non valido");
      return {
        utente_email: cols[colEmail] ?? "",
        data_valutazione: parseDate(cols[colData] ?? ""),
        punteggio,
        note: colNote !== -1 ? cols[colNote] : undefined,
      };
    } catch (e) {
      return {
        utente_email: cols[colEmail] ?? "",
        data_valutazione: cols[colData] ?? "",
        punteggio: 0,
        _error: e instanceof Error ? e.message : "Errore di parsing",
      };
    }
  });
}

export default function ImportaStorico() {
  const [isPending, startTransition] = useTransition();
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<{ inserted?: number; errors?: string[]; error?: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setRows(parseCsv(text));
    };
    reader.readAsText(file, "utf-8");
  };

  const validRows = rows?.filter((r) => !r._error) ?? [];
  const invalidRows = rows?.filter((r) => r._error) ?? [];

  const handleImport = () => {
    if (validRows.length === 0) return;
    setResult(null);
    startTransition(async () => {
      const res = await importStoricoPunteggi(validRows.map((r) => ({
        utente_email: r.utente_email,
        data_valutazione: r.data_valutazione,
        punteggio: r.punteggio,
        note: r.note,
      })));
      setResult(res);
      if (!res.error) {
        setRows(null);
        setFileName(null);
        if (fileRef.current) fileRef.current.value = "";
      }
    });
  };

  const reset = () => {
    setRows(null);
    setFileName(null);
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="space-y-5">
      {/* Drop zone */}
      <div className="border-2 border-dashed border-border rounded-xl p-8 text-center hover:border-primary transition-colors">
        <Upload className="w-8 h-8 text-text-muted mx-auto mb-3 opacity-60" />
        <p className="font-tenorite text-sm text-text mb-1">
          Carica un file CSV con i dati storici
        </p>
        <p className="text-xs text-text-muted mb-4">
          Colonne richieste: <code className="bg-bg-page px-1 rounded">data_valutazione</code>,{" "}
          <code className="bg-bg-page px-1 rounded">email_dipendente</code>,{" "}
          <code className="bg-bg-page px-1 rounded">punteggio</code>,{" "}
          <code className="bg-bg-page px-1 rounded">note</code> (opzionale)
        </p>
        <label className="inline-flex items-center gap-2 px-4 py-2 text-sm font-tenorite bg-primary hover:bg-primary-dark text-white rounded-lg cursor-pointer transition-colors">
          <Upload className="w-4 h-4" />
          Seleziona file CSV
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt"
            onChange={handleFile}
            className="sr-only"
          />
        </label>
        {fileName && (
          <p className="text-xs text-text-muted mt-3">
            File selezionato: <span className="font-medium text-text">{fileName}</span>
          </p>
        )}
      </div>

      {/* Preview */}
      {rows && rows.length > 0 && (
        <div className="bg-bg rounded-xl border border-border overflow-hidden">
          <div className="px-5 py-3 border-b border-border bg-bg-page flex items-center justify-between">
            <h3 className="font-tenorite text-sm text-text">
              Anteprima ({validRows.length} valide, {invalidRows.length} con errori)
            </h3>
            <button
              onClick={reset}
              className="text-xs text-text-muted hover:text-text transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-bg-page/50">
                  <th className="text-left font-tenorite text-text-muted px-4 py-2">Email</th>
                  <th className="text-left font-tenorite text-text-muted px-4 py-2">Data</th>
                  <th className="text-left font-tenorite text-text-muted px-4 py-2">Punteggio</th>
                  <th className="text-left font-tenorite text-text-muted px-4 py-2">Note</th>
                  <th className="text-left font-tenorite text-text-muted px-4 py-2">Stato</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r, i) => (
                  <tr key={i} className={r._error ? "bg-danger/5" : ""}>
                    <td className="px-4 py-2 text-text">{r.utente_email || "—"}</td>
                    <td className="px-4 py-2 text-text">{r.data_valutazione || "—"}</td>
                    <td className="px-4 py-2 text-text">{r._error ? "—" : r.punteggio}</td>
                    <td className="px-4 py-2 text-text-muted">{r.note || "—"}</td>
                    <td className="px-4 py-2">
                      {r._error ? (
                        <span className="text-danger flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          {r._error}
                        </span>
                      ) : (
                        <span className="text-success">
                          <Check className="w-3 h-3" />
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-5 py-4 border-t border-border flex items-center gap-3">
            <button
              onClick={handleImport}
              disabled={isPending || validRows.length === 0}
              className="px-4 py-2 text-sm font-tenorite bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {isPending ? "Importazione…" : `Importa ${validRows.length} righe`}
            </button>
            <button
              onClick={reset}
              className="px-4 py-2 text-sm text-text-muted hover:text-text border border-border rounded-lg transition-colors"
            >
              Annulla
            </button>
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div
          className={`flex items-start gap-3 rounded-lg px-4 py-3 text-sm border ${
            result.error
              ? "bg-danger/10 border-danger/30 text-danger"
              : "bg-success/10 border-success/30 text-success"
          }`}
        >
          {result.error ? (
            <>
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-tenorite">Errore durante l&apos;importazione</p>
                <p className="mt-0.5 text-xs">{result.error}</p>
              </div>
            </>
          ) : (
            <div>
              <p className="font-tenorite flex items-center gap-1.5">
                <Check className="w-4 h-4" />
                Importazione completata: {result.inserted} record inseriti
              </p>
              {result.errors && result.errors.length > 0 && (
                <div className="mt-2 text-xs text-warning">
                  <p className="font-tenorite mb-1">Avvisi ({result.errors.length}):</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
