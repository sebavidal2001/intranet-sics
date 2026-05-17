import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { UserPlus, Mail } from "lucide-react";
import { SortableHeader } from "@/components/ui/sortable-header";
import { parseSortParams } from "@/lib/sort-params";

interface UtenteRow {
  id: string;
  nome: string;
  cognome: string;
  username: string | null;
  ruolo: string;
  reparto: string | null;
}

const BADGE_RUOLO: Record<string, { label: string; bg: string; text: string }> = {
  superadmin:              { label: "Superadmin",        bg: "#C82381", text: "#fff" },
  amministratore:          { label: "Amministratore",    bg: "#00A1BE", text: "#fff" },
  admin:                   { label: "Admin",             bg: "#00A1BE", text: "#fff" },
  responsabile:            { label: "Responsabile",      bg: "#EE7326", text: "#fff" },
  responsabile_intermedio: { label: "Resp. Intermedio",  bg: "#F59E0B", text: "#fff" },
  collaboratore:           { label: "Collaboratore",     bg: "#95C11F", text: "#fff" },
};
const BADGE_DEFAULT = { bg: "#747373", text: "#fff" };

const DB_COL: Record<string, string> = {
  nome: "cognome", username: "username", ruolo: "ruolo", reparto: "reparto",
};

export default async function UtentiPage({
  searchParams,
}: {
  searchParams?: Promise<{ sort?: string; dir?: string }>;
}) {
  const params = searchParams ? await searchParams : {};
  const { sort, dir } = parseSortParams(params ?? {}, "nome");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("utenti")
    .select("id, nome, cognome, username, ruolo, reparto")
    .order(DB_COL[sort] ?? "cognome", { ascending: dir === "asc" });

  if (error) throw error;
  const utenti = (data ?? []) as UtenteRow[];
  const shProps = { currentSort: sort, currentDir: dir };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-tenorite text-3xl text-text">Utenti</h1>
          <p className="text-text-muted mt-1">Gestisci utenti, ruoli e credenziali</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/superadmin/utenti/allinea-email"
            className="inline-flex items-center gap-2 border border-border hover:border-primary hover:text-primary text-text-muted font-tenorite text-sm px-4 py-2.5 rounded-lg transition-colors"
          >
            <Mail className="w-4 h-4" />
            Allinea email
          </Link>
          <Link
            href="/superadmin/utenti/nuovo"
            className="inline-flex items-center gap-2 bg-primary hover:bg-primary-dark text-white font-tenorite text-sm px-4 py-2.5 rounded-lg transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            Nuovo utente
          </Link>
        </div>
      </div>

      <div className="bg-bg rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-bg-page">
              <th className="text-left px-5 py-3"><SortableHeader column="nome" label="Nome / Cognome" {...shProps} /></th>
              <th className="text-left px-5 py-3"><SortableHeader column="username" label="Username" {...shProps} /></th>
              <th className="text-left px-5 py-3"><SortableHeader column="ruolo" label="Ruolo" {...shProps} /></th>
              <th className="text-left px-5 py-3"><SortableHeader column="reparto" label="Reparto" {...shProps} /></th>
              <th className="text-right font-tenorite text-text-muted px-5 py-3">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {utenti.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-text-muted">
                  Nessun utente trovato.
                </td>
              </tr>
            )}
            {utenti.map((u) => {
              const badge = BADGE_RUOLO[u.ruolo] ?? { label: u.ruolo, ...BADGE_DEFAULT };
              return (
                <tr key={u.id} className="border-b border-border last:border-0 hover:bg-bg-page transition-colors">
                  <td className="px-5 py-3.5 font-tenorite text-text">{u.cognome} {u.nome}</td>
                  <td className="px-5 py-3.5 text-text-muted font-mono text-xs">
                    {u.username ?? <span className="italic">—</span>}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-tenorite"
                      style={{ backgroundColor: badge.bg, color: badge.text }}>
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-text-muted">{u.reparto ?? "—"}</td>
                  <td className="px-5 py-3.5 text-right">
                    <Link href={`/superadmin/utenti/${u.id}/modifica`}
                      className="text-primary hover:text-primary-dark text-xs font-tenorite transition-colors">
                      Modifica
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
