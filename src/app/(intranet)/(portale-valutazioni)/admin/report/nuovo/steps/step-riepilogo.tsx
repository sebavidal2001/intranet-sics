"use client";

import { Badge } from "@/components/ui/badge";
import { TIPO_ICONS, TIPO_LABELS } from "./blocco-item";
import type { BloccoInput } from "@/lib/types";
import type { InfoState } from "./step-info";

interface Props {
  info: InfoState;
  blocchi: BloccoInput[];
  ruoli: { slug: string; nome: string; colore: string }[];
}

export function StepRiepilogo({ info, blocchi, ruoli }: Props) {
  const ruoloNome = Object.fromEntries(ruoli.map((r) => [r.slug, r]));

  return (
    <div className="space-y-5">
      <div className="bg-bg-page rounded-xl border border-border p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-tenorite text-lg text-text">{info.nome || "(senza nome)"}</h3>
            {info.descrizione && <p className="text-sm text-text-muted mt-0.5">{info.descrizione}</p>}
          </div>
          <Badge variant={info.is_attivo ? "default" : "outline"}>
            {info.is_attivo ? "Attivo" : "Inattivo"}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {info.visibilita_ruoli.length === 0 ? (
            <span className="text-xs text-text-muted italic">Nessun ruolo assegnato</span>
          ) : info.visibilita_ruoli.map((slug) => {
            const r = ruoloNome[slug];
            return (
              <Badge key={slug} variant="outline" className="text-xs"
                style={r ? { borderColor: r.colore, color: r.colore } : undefined}>
                {r?.nome ?? slug}
              </Badge>
            );
          })}
        </div>
      </div>

      <div>
        <p className="text-sm text-text-muted mb-2">{blocchi.length} blocchi:</p>
        <div className="space-y-1.5">
          {blocchi.map((b, i) => (
            <div key={i} className="flex items-center gap-2 text-sm text-text">
              <span className="text-text-muted w-4">{i + 1}.</span>
              <span className="text-text-muted">{TIPO_ICONS[b.tipo]}</span>
              <Badge variant="outline" className="text-xs">{TIPO_LABELS[b.tipo]}</Badge>
              {b.titolo && <span className="text-text-muted">— {b.titolo}</span>}
            </div>
          ))}
          {blocchi.length === 0 && <p className="text-sm text-text-muted italic">Nessun blocco aggiunto.</p>}
        </div>
      </div>
    </div>
  );
}
