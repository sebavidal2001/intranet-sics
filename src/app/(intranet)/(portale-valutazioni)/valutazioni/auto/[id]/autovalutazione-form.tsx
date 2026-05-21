"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { salvaRisposteAuto } from "./actions";
import { ChevronDown, ChevronUp, Save, CheckCircle } from "lucide-react";

interface ParametroRadar {
  id: string;
  nome: string;
  colore: string;
}

interface MansioneAttiva {
  id: string;
  testo: string;
  ordine: number;
  ruolo_professionale: { id: string; nome: string } | null;
  parametro_radar: ParametroRadar | null;
}

interface SkillAttiva {
  id: string;
  nome: string;
  descrizione: string | null;
  ordine: number;
  parametro_radar: { id: string; nome: string; colore: string } | null;
}

interface ScalaValutazione {
  id: string;
  nome: string;
  min: number;
  max: number;
  labels: Record<string, string> | null;
}

interface AutvalutazioneFormProps {
  sessioneId: string;
  anno: number;
  mansioni: MansioneAttiva[];
  skills: SkillAttiva[];
  scala: ScalaValutazione;
  risposteAutoMansioni: Record<string, { punteggio: number; note: string | null }>;
  risposteAutoSkills: Record<string, { punteggio: number; note: string | null }>;
  isReadOnly: boolean;
  ordineProfili?: string[];
}
// NOTA: il form NON riceve le risposte del responsabile — l'autovalutazione
// deve essere "alla cieca" (il dipendente non deve vedere i voti del capo).

function buildScaleValues(min: number, max: number): number[] {
  const values: number[] = [];
  for (let v = min; v <= max; v++) values.push(v);
  return values;
}

export function AutvalutazioneForm({
  sessioneId,
  anno,
  mansioni,
  skills,
  scala,
  risposteAutoMansioni,
  risposteAutoSkills,
  isReadOnly,
  ordineProfili = [],
}: AutvalutazioneFormProps) {
  const router = useRouter();
  const scaleValues = buildScaleValues(scala.min, scala.max);
  const labels = scala.labels as Record<string, string> | null;

  const [valoriMansioni, setValoriMansioni] = useState<Record<string, number | null>>(
    mansioni.reduce<Record<string, number | null>>((acc, m) => {
      acc[m.id] = risposteAutoMansioni[m.id]?.punteggio ?? null;
      return acc;
    }, {})
  );
  const [noteMansioni, setNoteMansioni] = useState<Record<string, string>>(
    mansioni.reduce<Record<string, string>>((acc, m) => {
      acc[m.id] = risposteAutoMansioni[m.id]?.note ?? "";
      return acc;
    }, {})
  );
  const [valoriSkills, setValoriSkills] = useState<Record<string, number | null>>(
    skills.reduce<Record<string, number | null>>((acc, s) => {
      acc[s.id] = risposteAutoSkills[s.id]?.punteggio ?? null;
      return acc;
    }, {})
  );
  const [noteSkills, setNoteSkills] = useState<Record<string, string>>(
    skills.reduce<Record<string, string>>((acc, s) => {
      acc[s.id] = risposteAutoSkills[s.id]?.note ?? "";
      return acc;
    }, {})
  );
  const [noteAperte, setNoteAperte] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function toggleNote(id: string) {
    setNoteAperte((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function getLabelForValue(val: number): string {
    if (!labels) return "";
    return labels[String(val)] ?? "";
  }

  async function handleSave(completa: boolean) {
    if (isSubmitting) return;

    if (completa) {
      const unansweredM = mansioni.filter((m) => valoriMansioni[m.id] === null);
      const unansweredS = skills.filter((s) => valoriSkills[s.id] === null);
      const total = unansweredM.length + unansweredS.length;
      if (total > 0) {
        setError(`Rispondi a tutte le voci prima di completare (${total} mancanti).`);
        return;
      }
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    const result = await salvaRisposteAuto({
      sessione_id: sessioneId,
      risposteMansioni: mansioni
        .filter((m) => valoriMansioni[m.id] !== null)
        .map((m) => ({
          mansione_id: m.id,
          punteggio: valoriMansioni[m.id] as number,
          note: noteMansioni[m.id] || undefined,
        })),
      risposteSkills: skills
        .filter((s) => valoriSkills[s.id] !== null)
        .map((s) => ({
          skill_id: s.id,
          punteggio: valoriSkills[s.id] as number,
          note: noteSkills[s.id] || undefined,
        })),
      completa,
    });

    setIsSubmitting(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    if (completa) {
      router.push("/valutazioni");
    } else {
      setSuccess("Bozza salvata con successo");
    }
  }

  const answeredCount =
    mansioni.filter((m) => valoriMansioni[m.id] !== null).length +
    skills.filter((s) => valoriSkills[s.id] !== null).length;
  const totalCount = mansioni.length + skills.length;

  function renderItem(
    itemId: string,
    label: string,
    valoreAuto: number | null,
    onSelect: (val: number) => void,
    noteVal: string,
    onNoteChange: (val: string) => void,
    badge?: React.ReactNode
  ) {
    const labelAuto = valoreAuto !== null ? getLabelForValue(valoreAuto) : null;

    return (
      <div
        key={itemId}
        className={`rounded-xl border bg-bg p-5 space-y-4 transition-colors ${
          valoreAuto !== null ? "border-border" : "border-warning/40 bg-warning/5"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="font-tenorite text-base font-semibold text-text leading-snug">{label}</p>
          <div className="flex items-center gap-2 shrink-0">
            {valoreAuto !== null && (
              <span className="font-tenorite text-2xl font-bold text-primary">
                {valoreAuto}
                <span className="text-sm font-normal text-text-muted">/{scala.max}</span>
              </span>
            )}
            {badge}
          </div>
        </div>

        {/* Pulsanti scala */}
        <div className="space-y-2">
          <p className="text-xs text-text-muted font-tenorite uppercase tracking-wide">La tua valutazione</p>
          <div className={`flex flex-wrap ${scaleValues.length > 7 ? "gap-1.5" : "gap-2"}`}>
            {scaleValues.map((val) => {
              const isSelected = valoreAuto === val;
              const btnLabel = getLabelForValue(val);
              return (
                <button
                  key={val}
                  type="button"
                  title={btnLabel || String(val)}
                  onClick={() => !isReadOnly && onSelect(val)}
                  disabled={isReadOnly}
                  className={`
                    ${scaleValues.length <= 6 ? "min-w-[56px] px-3 py-2.5" : "min-w-[40px] px-2 py-2"}
                    rounded-lg border font-tenorite text-sm transition-all duration-150
                    ${isSelected
                      ? "bg-primary border-primary text-white shadow-sm"
                      : "bg-bg border-border text-text-muted hover:border-primary hover:text-primary"
                    }
                    disabled:cursor-not-allowed disabled:opacity-70
                  `}
                >
                  {scaleValues.length <= 5 && btnLabel ? (
                    <span className="flex flex-col items-center leading-tight">
                      <span className="text-base font-bold">{val}</span>
                      <span className="text-[10px] font-normal truncate max-w-[80px]">{btnLabel}</span>
                    </span>
                  ) : (
                    val
                  )}
                </button>
              );
            })}
          </div>
          {scaleValues.length > 5 && labelAuto && (
            <p className="text-sm text-primary font-medium">{valoreAuto} — {labelAuto}</p>
          )}
        </div>

        <div>
          <button
            type="button"
            onClick={() => toggleNote(itemId)}
            disabled={isReadOnly}
            className="flex items-center gap-1 text-sm text-text-muted hover:text-text transition-colors disabled:opacity-50"
          >
            {noteAperte[itemId] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {noteVal ? "Note (compilate)" : "Aggiungi nota (opzionale)"}
          </button>
          {(noteAperte[itemId] || noteVal) && (
            <textarea
              value={noteVal}
              onChange={(e) => onNoteChange(e.target.value)}
              disabled={isReadOnly}
              placeholder="Osservazioni, esempi concreti, motivazioni del punteggio..."
              rows={3}
              className="mt-2 w-full rounded-lg border border-border bg-bg-page px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-primary disabled:opacity-60 disabled:cursor-not-allowed resize-none"
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-tenorite text-3xl font-bold text-text">La tua autovalutazione</h1>
        <p className="text-text-muted mt-1">Anno {anno} · Scala: {scala.nome} ({scala.min}–{scala.max})</p>
      </div>

      {!isReadOnly && (
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 rounded-full bg-secondary-light overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${totalCount > 0 ? (answeredCount / totalCount) * 100 : 0}%` }}
            />
          </div>
          <span className="text-sm text-text-muted font-tenorite shrink-0">{answeredCount}/{totalCount}</span>
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-danger/10 border border-danger/30 text-danger px-4 py-3 text-sm">{error}</div>
      )}
      {success && (
        <div className="rounded-lg bg-success/10 border border-success/30 text-success px-4 py-3 text-sm flex items-center gap-2">
          <CheckCircle className="h-4 w-4 shrink-0" />{success}
        </div>
      )}
      {isReadOnly && (
        <div className="rounded-lg bg-secondary-light border border-border text-text-muted px-4 py-3 text-sm">
          Questa autovalutazione è stata completata. Puoi visualizzarla ma non modificarla.
        </div>
      )}

      {/* Mansioni — raggruppate per ruolo professionale */}
      {mansioni.length > 0 && (() => {
        const byRuolo = new Map<string, { id: string; nome: string; items: MansioneAttiva[] }>();
        const senzaRuolo: MansioneAttiva[] = [];
        for (const m of mansioni) {
          if (m.ruolo_professionale) {
            const key = m.ruolo_professionale.id;
            if (!byRuolo.has(key)) byRuolo.set(key, { id: key, nome: m.ruolo_professionale.nome, items: [] });
            byRuolo.get(key)?.items.push(m);
          } else {
            senzaRuolo.push(m);
          }
        }
        const sections = [
          ...Array.from(byRuolo.values()),
          ...(senzaRuolo.length > 0 ? [{ id: "__altro", nome: "Altro", items: senzaRuolo }] : []),
        ];
        if (ordineProfili.length > 0) {
          sections.sort((a, b) => {
            const ai = ordineProfili.indexOf(a.id);
            const bi = ordineProfili.indexOf(b.id);
            if (ai === -1 && bi === -1) return 0;
            if (ai === -1) return 1;
            if (bi === -1) return -1;
            return ai - bi;
          });
        }
        return (
          <div className="space-y-6">
            <h2 className="font-tenorite text-lg text-text border-b border-border pb-2">Mansioni</h2>
            {sections.map((section) => (
              <div key={section.nome} className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="font-tenorite text-xs text-text-muted uppercase tracking-widest">{section.nome}</span>
                  <span className="flex-1 h-px bg-border" />
                </div>
                {section.items.map((m) =>
                  renderItem(
                    m.id,
                    m.testo,
                    valoriMansioni[m.id],
                    (val) => setValoriMansioni((prev) => ({ ...prev, [m.id]: val })),
                    noteMansioni[m.id] ?? "",
                    (val) => setNoteMansioni((prev) => ({ ...prev, [m.id]: val })),
                    m.parametro_radar ? (
                      <Badge
                        className="text-white text-xs"
                        style={{ backgroundColor: m.parametro_radar.colore, borderColor: m.parametro_radar.colore }}
                      >
                        {m.parametro_radar.nome}
                      </Badge>
                    ) : undefined
                  )
                )}
              </div>
            ))}
          </div>
        );
      })()}

      {/* Skills — raggruppate per parametro radar */}
      {skills.length > 0 && (() => {
        const byParametro = new Map<string, { nome: string; colore: string; items: SkillAttiva[] }>();
        const senzaParametro: SkillAttiva[] = [];
        for (const s of skills) {
          if (s.parametro_radar) {
            const key = s.parametro_radar.id;
            if (!byParametro.has(key)) byParametro.set(key, { nome: s.parametro_radar.nome, colore: s.parametro_radar.colore, items: [] });
            byParametro.get(key)!.items.push(s);
          } else {
            senzaParametro.push(s);
          }
        }
        const sections = [
          ...Array.from(byParametro.values()),
          ...(senzaParametro.length > 0 ? [{ nome: "Senza parametro", colore: "#747373", items: senzaParametro }] : []),
        ];
        return (
          <div className="space-y-6">
            <h2 className="font-tenorite text-lg text-text border-b border-border pb-2">Skills</h2>
            {sections.map((section) => (
              <div key={section.nome} className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: section.colore }} />
                  <span className="font-tenorite text-xs text-text-muted uppercase tracking-widest">{section.nome}</span>
                  <span className="flex-1 h-px bg-border" />
                </div>
                {section.items.map((s) =>
                  renderItem(
                    s.id,
                    s.nome,
                    valoriSkills[s.id],
                    (val) => setValoriSkills((prev) => ({ ...prev, [s.id]: val })),
                    noteSkills[s.id] ?? "",
                    (val) => setNoteSkills((prev) => ({ ...prev, [s.id]: val })),
                    s.parametro_radar ? (
                      <Badge
                        className="text-white text-xs"
                        style={{ backgroundColor: s.parametro_radar.colore, borderColor: s.parametro_radar.colore }}
                      >
                        {s.parametro_radar.nome}
                      </Badge>
                    ) : undefined
                  )
                )}
              </div>
            ))}
          </div>
        );
      })()}

      {!isReadOnly && (
        <div className="flex justify-end gap-3 pt-2 pb-8">
          <Button variant="outline" onClick={() => handleSave(false)} disabled={isSubmitting}>
            <Save className="h-4 w-4 mr-2" />
            {isSubmitting ? "Salvataggio..." : "Salva bozza"}
          </Button>
          <Button
            onClick={() => handleSave(true)}
            disabled={isSubmitting}
            className="bg-primary hover:bg-primary-dark"
          >
            <CheckCircle className="h-4 w-4 mr-2" />
            {isSubmitting ? "Completamento..." : "Completa autovalutazione"}
          </Button>
        </div>
      )}
    </div>
  );
}
