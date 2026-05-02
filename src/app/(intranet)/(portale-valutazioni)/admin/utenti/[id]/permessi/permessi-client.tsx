"use client";

import { useState, useTransition } from "react";
import { Shield, ShieldCheck, ShieldOff, Download, Eye, CheckCircle2, Loader2 } from "lucide-react";
import { salvaPermessoPortale, type LivelloOverride } from "./actions";

interface Portale {
  id: string;
  nome: string;
  slug: string;
  icona: string | null;
  colore: string | null;
}

interface PermessoCorrente {
  portale_id: string;
  livello_effettivo: string | null; // da get_portale_livello
  override_access: boolean | null;
  override_export: boolean | null;
  is_portal_admin: boolean;
}

interface Props {
  utenteId: string;
  ruoloUtente: string;
  portali: Portale[];
  permessi: PermessoCorrente[];
}

const LIVELLI: { value: LivelloOverride; label: string; desc: string; icon: React.ReactNode; color: string }[] = [
  { value: "default",  label: "Default ruolo",  desc: "Segue i permessi del ruolo assegnato",     icon: <Shield className="w-4 h-4" />,          color: "text-text-muted"   },
  { value: "nessuno",  label: "Nessun accesso", desc: "Blocca l'accesso anche se il ruolo lo prevede", icon: <ShieldOff className="w-4 h-4" />,   color: "text-danger"       },
  { value: "viewer",   label: "Visualizzatore", desc: "Solo lettura, nessun export",              icon: <Eye className="w-4 h-4" />,              color: "text-text-muted"   },
  { value: "exporter", label: "Esportatore",    desc: "Lettura + download PDF/CSV",               icon: <Download className="w-4 h-4" />,         color: "text-warning"      },
  { value: "admin",    label: "Admin portale",  desc: "Gestione completa del portale",            icon: <ShieldCheck className="w-4 h-4" />,      color: "text-primary"      },
];

const LIVELLO_BADGE: Record<string, { label: string; cls: string }> = {
  superadmin: { label: "Superadmin",      cls: "bg-purple-100 text-purple-700" },
  admin:      { label: "Admin portale",   cls: "bg-primary-light text-primary" },
  exporter:   { label: "Esportatore",     cls: "bg-warning/10 text-warning" },
  viewer:     { label: "Visualizzatore",  cls: "bg-secondary-light text-text-muted" },
};

function getCurrentOverride(p: PermessoCorrente): LivelloOverride {
  if (p.is_portal_admin) return "admin";
  if (p.override_export) return "exporter";
  if (p.override_access === true) return "viewer";
  if (p.override_access === false) return "nessuno";
  return "default";
}

export default function PermessiClient({ utenteId, ruoloUtente, portali, permessi }: Props) {
  const [isPending, startTransition] = useTransition();
  const [localPermessi, setLocalPermessi] = useState<Record<string, LivelloOverride>>(
    Object.fromEntries(portali.map((p) => {
      const perm = permessi.find((x) => x.portale_id === p.id);
      return [p.id, perm ? getCurrentOverride(perm) : "default"];
    }))
  );
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});

  function handleChange(portaleId: string, livello: LivelloOverride) {
    setLocalPermessi((prev) => ({ ...prev, [portaleId]: livello }));
    setSavedIds((prev) => { const s = new Set(prev); s.delete(portaleId); return s; });
  }

  function handleSave(portaleId: string) {
    startTransition(async () => {
      const result = await salvaPermessoPortale(utenteId, portaleId, localPermessi[portaleId]);
      if (result.error) {
        setErrors((prev) => ({ ...prev, [portaleId]: result.error! }));
      } else {
        setSavedIds((prev) => new Set(prev).add(portaleId));
        setErrors((prev) => { const e = { ...prev }; delete e[portaleId]; return e; });
      }
    });
  }

  const livelloEffettivo = (portaleId: string) => {
    const perm = permessi.find((x) => x.portale_id === portaleId);
    return perm?.livello_effettivo ?? null;
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-primary-light/50 border border-primary/20 px-4 py-3 text-sm text-text-muted">
        Ruolo utente: <span className="font-tenorite text-text">{ruoloUtente}</span> — i permessi di default derivano dal ruolo.
        Gli override qui sotto hanno priorità sul ruolo.
      </div>

      {portali.map((portale) => {
        const livello = localPermessi[portale.id] ?? "default";
        const effettivo = livelloEffettivo(portale.id);
        const isSaved = savedIds.has(portale.id);
        const err = errors[portale.id];

        return (
          <div key={portale.id} className="rounded-xl border border-border bg-bg p-5">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center text-white text-sm font-tenorite shrink-0"
                  style={{ backgroundColor: portale.colore ?? "#747373" }}
                >
                  {portale.nome[0]}
                </div>
                <div>
                  <p className="font-tenorite text-text">{portale.nome}</p>
                  <p className="text-xs text-text-muted">{portale.slug}</p>
                </div>
              </div>
              {effettivo && LIVELLO_BADGE[effettivo] && (
                <span className={`text-xs font-tenorite px-2 py-0.5 rounded-full ${LIVELLO_BADGE[effettivo].cls}`}>
                  Livello attuale: {LIVELLO_BADGE[effettivo].label}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
              {LIVELLI.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleChange(portale.id, opt.value)}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border text-xs font-tenorite transition-all ${
                    livello === opt.value
                      ? "border-primary bg-primary-light text-primary"
                      : "border-border text-text-muted hover:border-primary/50 hover:text-text"
                  }`}
                >
                  <span className={livello === opt.value ? "text-primary" : opt.color}>
                    {opt.icon}
                  </span>
                  {opt.label}
                </button>
              ))}
            </div>

            {err && (
              <p className="text-xs text-danger mb-2">{err}</p>
            )}

            <div className="flex items-center justify-between">
              <p className="text-xs text-text-muted">
                {LIVELLI.find((o) => o.value === livello)?.desc}
              </p>
              <button
                onClick={() => handleSave(portale.id)}
                disabled={isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-tenorite bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : isSaved ? (
                  <CheckCircle2 className="w-3 h-3" />
                ) : null}
                {isSaved ? "Salvato" : "Salva"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
