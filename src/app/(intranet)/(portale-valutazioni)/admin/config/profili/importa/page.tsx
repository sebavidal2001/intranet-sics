"use client";

import { useState, useRef, useTransition } from "react";
import Link from "next/link";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import {
  Upload,
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  X,
} from "lucide-react";
import { importMansioni } from "../actions";
import * as XLSX from "xlsx";

interface PreviewRow {
  ruolo_professionale: string;
  parametro: string;
  mansione: string;
}

type ImportResult =
  | { success: true; count: number; errors: string[] }
  | { success: false; error: string; missingParametri?: string[] };

export default function ImportaPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [allRows, setAllRows] = useState<PreviewRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const REQUIRED_COLUMNS = ["ruolo_professionale", "parametro", "mansione"];

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setParseError(null);
    setImportResult(null);
    setPreview([]);
    setAllRows([]);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rawRows = XLSX.utils.sheet_to_json<Record<string, string>>(
          firstSheet,
          { defval: "" }
        );

        if (rawRows.length === 0) {
          setParseError("Il file è vuoto o non contiene righe di dati.");
          return;
        }

        // Verifica colonne
        const headers = Object.keys(rawRows[0]).map((h) =>
          h.toLowerCase().trim()
        );
        const missing = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
        if (missing.length > 0) {
          setParseError(
            `Colonne mancanti: ${missing.join(", ")}. ` +
              `Il file deve avere le colonne: ruolo_professionale, parametro, mansione.`
          );
          return;
        }

        // Normalizza righe
        const normalized: PreviewRow[] = rawRows
          .map((row) => {
            const lowerRow: Record<string, string> = {};
            for (const key of Object.keys(row)) {
              lowerRow[key.toLowerCase().trim()] = String(row[key]).trim();
            }
            return {
              ruolo_professionale: lowerRow["ruolo_professionale"] || "",
              parametro: lowerRow["parametro"] || "",
              mansione: lowerRow["mansione"] || "",
            };
          })
          .filter(
            (r) => r.ruolo_professionale && r.parametro && r.mansione
          );

        if (normalized.length === 0) {
          setParseError(
            "Nessuna riga valida trovata. Assicurati che i campi non siano vuoti."
          );
          return;
        }

        setAllRows(normalized);
        setPreview(normalized.slice(0, 10));
      } catch {
        setParseError(
          "Errore nella lettura del file. Assicurati che sia un file XLSX/XLS valido."
        );
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    // Simula il cambio file sull'input nascosto
    const dt = new DataTransfer();
    dt.items.add(file);
    if (fileInputRef.current) {
      fileInputRef.current.files = dt.files;
      fileInputRef.current.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };

  const handleImport = () => {
    if (!allRows.length) return;
    setImportResult(null);

    startTransition(async () => {
      const result = await importMansioni(allRows);
      setImportResult(result);
    });
  };

  const handleReset = () => {
    setFileName(null);
    setPreview([]);
    setAllRows([]);
    setParseError(null);
    setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Breadcrumbs items={[
        { label: "Config", href: "/admin/config" },
        { label: "Profili professionali", href: "/admin/config/profili" },
        { label: "Importa XLSX" },
      ]} />
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-tenorite text-2xl text-text">
          Importa da XLSX
        </h1>
        <p className="text-text-muted text-sm mt-1">
          Carica un file Excel per importare mansioni in bulk. Le colonne
          richieste sono:{" "}
          <code className="text-xs bg-secondary-light px-1.5 py-0.5 rounded font-mono">
            ruolo_professionale
          </code>
          ,{" "}
          <code className="text-xs bg-secondary-light px-1.5 py-0.5 rounded font-mono">
            parametro
          </code>
          ,{" "}
          <code className="text-xs bg-secondary-light px-1.5 py-0.5 rounded font-mono">
            mansione
          </code>
          .
        </p>
      </div>

      {/* Drop zone */}
      {!fileName ? (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className="bg-bg border-2 border-dashed border-border hover:border-primary rounded-xl p-12 text-center cursor-pointer transition-colors group"
        >
          <FileSpreadsheet className="w-12 h-12 text-text-muted/40 group-hover:text-primary/60 mx-auto mb-4 transition-colors" />
          <p className="font-tenorite text-text mb-1">
            Trascina il file qui, oppure clicca per selezionarlo
          </p>
          <p className="text-sm text-text-muted">
            Formati supportati: .xlsx, .xls
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>
      ) : (
        <div className="bg-bg rounded-xl border border-border p-4 flex items-center gap-3">
          <FileSpreadsheet className="w-8 h-8 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-tenorite text-sm text-text truncate">
              {fileName}
            </p>
            <p className="text-xs text-text-muted">
              {allRows.length} righe valide
            </p>
          </div>
          <button
            onClick={handleReset}
            className="p-1.5 text-text-muted hover:text-danger rounded-lg transition-colors"
            title="Rimuovi file"
          >
            <X className="w-4 h-4" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>
      )}

      {/* Errore parsing */}
      {parseError && (
        <div className="mt-4 flex items-start gap-3 bg-danger/10 border border-danger/30 text-danger rounded-lg p-4 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-tenorite mb-1">Errore nel file</p>
            <p>{parseError}</p>
          </div>
        </div>
      )}

      {/* Risultato import */}
      {importResult && (
        <div
          className={`mt-4 flex items-start gap-3 rounded-lg p-4 text-sm ${
            importResult.success
              ? "bg-success/10 border border-success/30 text-success"
              : "bg-danger/10 border border-danger/30 text-danger"
          }`}
        >
          {importResult.success ? (
            <>
              <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-tenorite mb-1">
                  Importazione completata — {importResult.count} mansioni
                  importate
                </p>
                {importResult.errors.length > 0 && (
                  <div className="mt-2 text-warning">
                    <p className="font-tenorite mb-1">
                      {importResult.errors.length} errori:
                    </p>
                    <ul className="list-disc list-inside space-y-0.5">
                      {importResult.errors.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-tenorite mb-1">Importazione fallita</p>
                <p>{importResult.error}</p>
                {importResult.missingParametri &&
                  importResult.missingParametri.length > 0 && (
                    <div className="mt-2">
                      <p className="font-tenorite mb-1">
                        Parametri radar non trovati:
                      </p>
                      <ul className="list-disc list-inside space-y-0.5">
                        {importResult.missingParametri.map((p, i) => (
                          <li key={i} className="font-mono text-xs">
                            {p}
                          </li>
                        ))}
                      </ul>
                      <Link
                        href="/admin/config/parametri/nuovo"
                        className="inline-block mt-2 text-xs underline underline-offset-2 hover:opacity-80 transition-opacity"
                      >
                        Crea i parametri mancanti →
                      </Link>
                    </div>
                  )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Preview tabella */}
      {preview.length > 0 && !importResult && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-tenorite text-xl text-text">
              Anteprima
              {allRows.length > 10 && (
                <span className="text-sm font-normal text-text-muted ml-2">
                  (prime 10 di {allRows.length} righe)
                </span>
              )}
            </h2>
            <button
              onClick={handleImport}
              disabled={isPending}
              className="inline-flex items-center gap-2 bg-primary hover:bg-primary-dark text-white font-tenorite px-5 py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              <Upload className="w-4 h-4" />
              {isPending
                ? "Importazione…"
                : `Importa ${allRows.length} righe`}
            </button>
          </div>

          <div className="bg-bg rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-bg-page border-b border-border">
                    <th className="text-left font-tenorite text-xs text-text-muted px-4 py-2.5">
                      #
                    </th>
                    <th className="text-left font-tenorite text-xs text-text-muted px-4 py-2.5">
                      Ruolo professionale
                    </th>
                    <th className="text-left font-tenorite text-xs text-text-muted px-4 py-2.5">
                      Parametro radar
                    </th>
                    <th className="text-left font-tenorite text-xs text-text-muted px-4 py-2.5">
                      Mansione
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {preview.map((row, idx) => (
                    <tr
                      key={idx}
                      className={
                        idx % 2 === 0 ? "bg-bg" : "bg-bg-page"
                      }
                    >
                      <td className="px-4 py-2.5 text-xs text-text-muted font-mono">
                        {idx + 1}
                      </td>
                      <td className="px-4 py-2.5 text-text font-tenorite text-xs">
                        {row.ruolo_professionale}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-1.5 text-xs bg-primary-light text-primary px-2 py-0.5 rounded-full">
                          {row.parametro}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-text text-xs">
                        {row.mansione}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Istruzioni formato */}
      <div className="mt-6 bg-primary-light border border-primary/20 rounded-xl p-5">
        <h3 className="font-tenorite text-sm text-text mb-3">
          Formato file atteso
        </h3>
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead>
              <tr>
                {["ruolo_professionale", "parametro", "mansione"].map((h) => (
                  <th
                    key={h}
                    className="text-left font-mono text-primary px-3 py-1.5 bg-primary/10 rounded first:rounded-l last:rounded-r border-r border-primary/10 last:border-0"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ["Magazziniere", "Efficienza operativa", "Gestione magazzino"],
                [
                  "Magazziniere",
                  "Competenze tecniche",
                  "Utilizzo software gestionale",
                ],
                ["Back Office", "Comunicazione", "Gestione email clienti"],
              ].map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className="px-3 py-1.5 text-text-muted border-r border-primary/10 last:border-0"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="mt-3 space-y-1 text-xs text-text-muted list-disc list-inside">
          <li>
            I ruoli professionali non esistenti vengono creati automaticamente.
          </li>
          <li>
            I parametri radar devono già esistere nel sistema (sono case-insensitive).
          </li>
          <li>Le righe con campi vuoti vengono ignorate.</li>
        </ul>
      </div>
    </div>
  );
}
