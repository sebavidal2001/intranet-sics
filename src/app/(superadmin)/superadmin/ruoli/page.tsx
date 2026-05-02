import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Key, CheckCircle2, XCircle } from "lucide-react";

type Ruolo = "superadmin" | "admin" | "responsabile" | "collaboratore";

interface PortaleConPermessi {
  id: string;
  nome: string;
  slug: string;
  colore: string | null;
  is_attivo: boolean;
  permessi: {
    ruolo: string;
    can_access: boolean;
    can_export: boolean;
    can_approve: boolean;
  }[];
}

const RUOLI_SISTEMA: {
  ruolo: Ruolo;
  label: string;
  descrizione: string;
  colore: string;
}[] = [
  {
    ruolo: "superadmin",
    label: "Superadmin",
    descrizione: "Accesso totale a tutti i portali e alla configurazione della piattaforma.",
    colore: "#C82381",
  },
  {
    ruolo: "admin",
    label: "Admin",
    descrizione: "Configura scala, parametri radar, KPI e sblocca le sessioni di valutazione.",
    colore: "#00A1BE",
  },
  {
    ruolo: "responsabile",
    label: "Responsabile",
    descrizione: "Valuta i propri collaboratori e visualizza le analisi del suo reparto.",
    colore: "#EE7326",
  },
  {
    ruolo: "collaboratore",
    label: "Collaboratore",
    descrizione: "Compila l'autovalutazione e visualizza i propri risultati e trend.",
    colore: "#95C11F",
  },
];

async function getPortaliConPermessi(): Promise<PortaleConPermessi[]> {
  const supabase = await createClient();

  const [portaliRes, permessiRes] = await Promise.all([
    supabase
      .from("portali")
      .select("id, nome, slug, colore, is_attivo")
      .order("ordine", { ascending: true }),
    supabase
      .from("permessi_portale")
      .select("portale_id, ruolo, can_access, can_export, can_approve"),
  ]);

  const portali = (portaliRes.data ?? []) as {
    id: string;
    nome: string;
    slug: string;
    colore: string | null;
    is_attivo: boolean;
  }[];

  const permessi = (permessiRes.data ?? []) as {
    portale_id: string;
    ruolo: string;
    can_access: boolean;
    can_export: boolean;
    can_approve: boolean;
  }[];

  return portali.map((p) => ({
    ...p,
    permessi: permessi.filter((perm) => perm.portale_id === p.id),
  }));
}

function PermessoBadge({ value }: { value: boolean }) {
  return value ? (
    <CheckCircle2 className="w-4 h-4 text-success" />
  ) : (
    <XCircle className="w-4 h-4 text-text-muted opacity-40" />
  );
}

export default async function RuoliPage() {
  const portali = await getPortaliConPermessi();

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="font-tenorite text-3xl text-text">Ruoli & accessi</h1>
        <p className="text-text-muted mt-1">
          Panoramica dei ruoli di sistema e dei permessi su ogni portale
        </p>
      </div>

      {/* Griglia ruoli */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {RUOLI_SISTEMA.map((r) => (
          <div
            key={r.ruolo}
            className="bg-bg rounded-xl border border-border p-5 space-y-2"
          >
            <div className="flex items-center gap-3">
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: r.colore }}
              />
              <h2 className="font-tenorite text-base text-text">{r.label}</h2>
            </div>
            <p className="text-sm text-text-muted">{r.descrizione}</p>
          </div>
        ))}
      </div>

      {/* Tabella permessi per portale */}
      <div className="space-y-4">
        <h2 className="font-tenorite text-lg text-text">Permessi per portale</h2>

        {portali.length === 0 && (
          <div className="bg-bg rounded-xl border border-border p-8 text-center text-text-muted text-sm">
            Nessun portale configurato.
          </div>
        )}

        {portali.map((portale) => (
          <div
            key={portale.id}
            className="bg-bg rounded-xl border border-border overflow-hidden"
          >
            {/* Portale header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-bg-page">
              <div className="flex items-center gap-3">
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: portale.colore ?? "#e2e8f0" }}
                />
                <span className="font-tenorite text-sm text-text">{portale.nome}</span>
                <span className="font-mono text-xs text-text-muted">{portale.slug}</span>
                {!portale.is_attivo && (
                  <span className="text-xs text-text-muted bg-bg-page border border-border rounded-full px-2 py-0.5">
                    Inattivo
                  </span>
                )}
              </div>
              <Link
                href={`/superadmin/portali/${portale.id}/permessi`}
                className="inline-flex items-center gap-1.5 text-xs font-tenorite text-primary hover:text-primary-dark transition-colors"
              >
                <Key className="w-3.5 h-3.5" />
                Configura permessi
              </Link>
            </div>

            {/* Tabella ruoli x permessi */}
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left font-tenorite text-text-muted px-5 py-2.5 text-xs">
                    Ruolo
                  </th>
                  <th className="text-center font-tenorite text-text-muted px-4 py-2.5 text-xs">
                    Accesso
                  </th>
                  <th className="text-center font-tenorite text-text-muted px-4 py-2.5 text-xs">
                    Export
                  </th>
                  <th className="text-center font-tenorite text-text-muted px-4 py-2.5 text-xs">
                    Approvazione
                  </th>
                </tr>
              </thead>
              <tbody>
                {RUOLI_SISTEMA.map((r) => {
                  const perm = portale.permessi.find((p) => p.ruolo === r.ruolo);
                  const canAccess = r.ruolo === "superadmin" ? true : (perm?.can_access ?? false);
                  const canExport = r.ruolo === "superadmin" ? true : (perm?.can_export ?? false);
                  const canApprove = r.ruolo === "superadmin" ? true : (perm?.can_approve ?? false);

                  return (
                    <tr
                      key={r.ruolo}
                      className="border-b border-border last:border-0 hover:bg-bg-page transition-colors"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: r.colore }}
                          />
                          <span className="font-tenorite text-xs text-text">{r.label}</span>
                          {r.ruolo === "superadmin" && (
                            <span className="text-xs text-text-muted italic">(sempre)</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex justify-center">
                          <PermessoBadge value={canAccess} />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex justify-center">
                          <PermessoBadge value={canExport} />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex justify-center">
                          <PermessoBadge value={canApprove} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
