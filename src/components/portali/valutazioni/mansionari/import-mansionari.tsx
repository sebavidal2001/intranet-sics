"use client";

import { useState } from "react";
import { Upload, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import type { ImportResult } from "@/lib/types";

interface ImportMansionariProps {
  anno: number;
  onImportComplete?: () => void;
}

export function ImportMansionari({ anno, onImportComplete }: ImportMansionariProps) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setResult(null);
    }
  };

  const parseFile = async (file: File): Promise<any[]> => {
    const ext = file.name.split(".").pop()?.toLowerCase();

    if (ext === "csv") {
      return new Promise((resolve, reject) => {
        Papa.parse(file, {
          header: true,
          complete: (results) => resolve(results.data),
          error: (error) => reject(error),
        });
      });
    } else if (ext === "xlsx" || ext === "xls") {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      return XLSX.utils.sheet_to_json(worksheet);
    } else {
      throw new Error("Formato file non supportato");
    }
  };

  const handleImport = async () => {
    if (!file) return;

    setLoading(true);
    setResult(null);

    try {
      // 1. Parse file
      const data = await parseFile(file);

      // 2. Valida e trasforma dati
      const errors: { row: number; reason: string }[] = [];
      const warnings: { row: number; reason: string }[] = [];
      const mansionariValid: any[] = [];

      data.forEach((row: any, idx: number) => {
        const rowNum = idx + 2; // +2 perché 1 è header, parte da 2

        // Valida campi obbligatori
        if (!row.nome || !row.email) {
          errors.push({
            row: rowNum,
            reason: "Nome o email mancante",
          });
          return;
        }

        if (!row.mansione) {
          errors.push({
            row: rowNum,
            reason: "Mansione mancante",
          });
          return;
        }

        // Estrai competenze (separata da virgola o array)
        let competenze: string[] = [];
        if (row.competenze) {
          if (Array.isArray(row.competenze)) {
            competenze = row.competenze;
          } else if (typeof row.competenze === "string") {
            competenze = row.competenze
              .split(",")
              .map((c: string) => c.trim())
              .filter(Boolean);
          }
        }

        if (competenze.length === 0) {
          warnings.push({
            row: rowNum,
            reason: "Nessuna competenza specificata",
          });
        }

        mansionariValid.push({
          nome: row.nome.trim(),
          cognome: row.cognome?.trim() || "",
          email: row.email.trim().toLowerCase(),
          reparto: row.reparto?.trim() || "Non specificato",
          mansione: row.mansione.trim(),
          competenze,
        });
      });

      // 3. Salva su Supabase
      const response = await fetch("/api/mansionari/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anno,
          mansionari: mansionariValid,
        }),
      });

      const apiResult = await response.json();

      if (!response.ok) {
        throw new Error(apiResult.error || "Errore durante l'import");
      }

      setResult({
        success: apiResult.success || mansionariValid.length,
        errors: [...errors, ...(apiResult.errors || [])],
        warnings: [...warnings, ...(apiResult.warnings || [])],
      });

      if (onImportComplete) onImportComplete();
    } catch (error) {
      console.error(error);
      setResult({
        success: 0,
        errors: [{ row: 0, reason: (error as Error).message }],
        warnings: [],
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Importa Mansionari {anno}</CardTitle>
        <CardDescription>
          Carica un file CSV o XLSX con le seguenti colonne: nome, cognome, email, reparto, mansione, competenze
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* File Input */}
        <div className="flex items-center gap-4">
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleFileChange}
            className="hidden"
            id="file-upload"
          />
          <label htmlFor="file-upload">
            <Button variant="outline" asChild>
              <span className="cursor-pointer">
                <Upload className="mr-2 h-4 w-4" />
                Seleziona File
              </span>
            </Button>
          </label>
          {file && (
            <span className="text-sm text-text-muted">{file.name}</span>
          )}
        </div>

        {/* Import Button */}
        <Button onClick={handleImport} disabled={!file || loading}>
          {loading ? "Importazione..." : "Importa Mansionari"}
        </Button>

        {/* Results */}
        {result && (
          <div className="space-y-4">
            {/* Success */}
            {result.success > 0 && (
              <div className="flex items-start gap-3 bg-success/10 border border-success text-success px-4 py-3 rounded-lg">
                <CheckCircle2 className="h-5 w-5 mt-0.5" />
                <div>
                  <p className="font-semibold">
                    {result.success} mansionari importati con successo
                  </p>
                </div>
              </div>
            )}

            {/* Warnings */}
            {result.warnings.length > 0 && (
              <div className="space-y-2">
                <p className="font-tenorite text-sm font-medium text-warning">
                  Avvisi ({result.warnings.length})
                </p>
                <div className="space-y-1">
                  {result.warnings.map((w, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-2 text-sm text-text-muted bg-warning/10 px-3 py-2 rounded"
                    >
                      <Badge variant="warning" className="mt-0.5">
                        Riga {w.row}
                      </Badge>
                      <span>{w.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Errors */}
            {result.errors.length > 0 && (
              <div className="space-y-2">
                <p className="font-tenorite text-sm font-medium text-danger">
                  Errori ({result.errors.length})
                </p>
                <div className="space-y-1">
                  {result.errors.map((e, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-2 text-sm text-danger bg-danger/10 px-3 py-2 rounded"
                    >
                      <AlertCircle className="h-4 w-4 mt-0.5" />
                      {e.row > 0 && (
                        <Badge variant="danger" className="mt-0.5">
                          Riga {e.row}
                        </Badge>
                      )}
                      <span>{e.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Template Info */}
        <div className="bg-primary-light border border-primary/20 p-4 rounded-lg">
          <p className="font-tenorite text-sm font-medium text-primary mb-2">
            Formato Template
          </p>
          <div className="text-xs text-text-muted space-y-1">
            <p>
              <strong>Colonne richieste:</strong> nome, cognome, email, reparto, mansione, competenze
            </p>
            <p>
              <strong>Competenze:</strong> separare con virgola (es: &quot;Excel, PowerPoint, SAP&quot;)
            </p>
            <p>
              <strong>Email:</strong> deve corrispondere a un utente esistente nel sistema
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
