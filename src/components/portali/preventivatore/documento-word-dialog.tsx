"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileText, CheckCircle2, XCircle } from "lucide-react";
import { parseWordCommerciale } from "./word-formatter";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  testo: string;
  intestazioneFallback?: string | null; // cliente, per quando il parse non trova "Spett.le"
  codice?: string | null;
}

export function DocumentoWordDialog({ open, onOpenChange, testo, intestazioneFallback, codice }: Props) {
  const doc = parseWordCommerciale(testo);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-[#00a1be]" />
            Documento commerciale {codice ? `· ${codice}` : ""}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2 px-1 text-sm leading-relaxed">
          {/* Intestazione */}
          {(doc.destinatario || intestazioneFallback) && (
            <div className="border-l-2 border-[#00a1be] pl-3">
              <div className="text-[10px] uppercase tracking-widest text-text-muted">Spett.le</div>
              <div className="font-medium text-text text-base">
                {doc.destinatario ?? intestazioneFallback}
              </div>
            </div>
          )}

          {/* Alla c.a. */}
          {doc.attenzione.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-widest text-text-muted mb-1">
                Alla cortese attenzione di
              </div>
              <ul className="space-y-0.5">
                {doc.attenzione.map((p, i) => (
                  <li key={i} className="text-text">
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Oggetto */}
          {doc.oggetto && (
            <div className="bg-bg-page rounded-lg p-3 border border-border">
              <div className="text-[10px] uppercase tracking-widest text-text-muted mb-0.5">Oggetto</div>
              <div className="font-medium text-text">{doc.oggetto}</div>
            </div>
          )}

          {/* Voci numerate */}
          {doc.voci.length > 0 && (
            <div className="space-y-4">
              {doc.voci.map((v, i) => (
                <div key={i} className="border border-border rounded-lg p-4 bg-bg">
                  <div className="flex items-start gap-3">
                    <div className="shrink-0 w-8 h-8 rounded-full bg-[#00a1be]/10 text-[#007a91] flex items-center justify-center font-mono text-sm font-bold">
                      {v.numero}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-text leading-snug">{v.titolo}</h3>
                      {v.comprendente.length > 0 && (
                        <>
                          <div className="text-[10px] uppercase tracking-widest text-text-muted mt-3 mb-1.5">
                            Comprendente
                          </div>
                          <ul className="space-y-1">
                            {v.comprendente.map((punto, j) => (
                              <li key={j} className="text-text-muted flex items-start gap-2">
                                <span className="text-[#00a1be] mt-1.5 shrink-0">•</span>
                                <span className="leading-relaxed">{punto}</span>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Compreso nella fornitura */}
          {doc.compreso.length > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-4 h-4 text-green-700" />
                <span className="text-xs font-semibold text-green-800 uppercase tracking-wide">
                  Compreso nella fornitura
                </span>
              </div>
              <ul className="space-y-1 pl-1">
                {doc.compreso.map((p, i) => (
                  <li key={i} className="text-sm text-green-900 flex items-start gap-2">
                    <span className="text-green-700 mt-1 shrink-0">✓</span>
                    <span className="leading-relaxed">{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Escluso dalla fornitura */}
          {doc.escluso.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <XCircle className="w-4 h-4 text-red-700" />
                <span className="text-xs font-semibold text-red-800 uppercase tracking-wide">
                  Escluso dalla fornitura
                </span>
              </div>
              <ul className="space-y-1 pl-1">
                {doc.escluso.map((p, i) => (
                  <li key={i} className="text-sm text-red-900 flex items-start gap-2">
                    <span className="text-red-700 mt-1 shrink-0">✗</span>
                    <span className="leading-relaxed">{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Testo residuo (se il parser non ha riconosciuto niente) */}
          {doc.testo_residuo && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="text-xs font-semibold text-yellow-800 uppercase tracking-wide mb-2">
                Formato non riconosciuto — testo originale
              </div>
              <pre className="text-sm whitespace-pre-wrap font-sans text-text leading-relaxed">
                {doc.testo_residuo}
              </pre>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
