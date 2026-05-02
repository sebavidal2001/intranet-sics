import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser, getSessionIsAdmin } from "@/lib/auth/session";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { FileDown, ExternalLink } from "lucide-react";
import { SortableHeader } from "@/components/ui/sortable-header";
import { parseSortParams } from "@/lib/sort-params";

export const dynamic = "force-dynamic";

const STATO_LABEL: Record<string, string> = { completata: "Completata", certificata: "Certificata" };
const STATO_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  completata: "default", certificata: "secondary",
};

interface SearchParams { anno?: string; reparto?: string; sort?: string; dir?: string; [key: string]: string | undefined; }

type SessioneRow = {
  id: string; anno: number; stato: string;
  utente: { id: string; nome: string; cognome: string; reparto?: string } | null;
  responsabile: { nome: string; cognome: string } | null;
};

export default async function AdminValutazioniPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [user, isAdmin] = await Promise.all([getSessionUser(), getSessionIsAdmin()]);
  if (!user) redirect("/auth/login");
  if (!isAdmin) redirect("/");

  const params = await searchParams;
  const db = createAdminClient();
  const { sort, dir } = parseSortParams(params, "collaboratore");

  const annoCorrente = new Date().getFullYear();
  const anni = [annoCorrente, annoCorrente - 1, annoCorrente - 2];

  const { data: sessioni } = await db
    .from("sessioni_utente")
    .select(`
      id, anno, stato, data_programmata, tipo_valutazione,
      utente:utenti!sessioni_utente_utente_id_fkey(id, nome, cognome, reparto, ruolo),
      responsabile:utenti!sessioni_utente_responsabile_id_fkey(nome, cognome)
    `)
    .in("stato", ["completata", "certificata"])
    .order("anno", { ascending: false });

  const reparti = [
    ...new Set(
      (sessioni ?? [])
        .map((s) => (s.utente as { reparto?: string } | null)?.reparto)
        .filter(Boolean) as string[]
    ),
  ].sort();

  let sessioniFiltrate = (sessioni ?? []).filter((s) => {
    if (params.anno && String((s as unknown as { anno: number }).anno) !== params.anno) return false;
    if (params.reparto) {
      const utente = s.utente as { reparto?: string } | null;
      if (utente?.reparto !== params.reparto) return false;
    }
    return true;
  }) as unknown as SessioneRow[];

  // Ordinamento client-side (join annidato non filtrabile via query builder)
  sessioniFiltrate = [...sessioniFiltrate].sort((a, b) => {
    const asc = dir === "asc" ? 1 : -1;
    switch (sort) {
      case "collaboratore":
        return asc * (`${a.utente?.cognome} ${a.utente?.nome}`.localeCompare(`${b.utente?.cognome} ${b.utente?.nome}`));
      case "reparto":
        return asc * ((a.utente?.reparto ?? "").localeCompare(b.utente?.reparto ?? ""));
      case "responsabile":
        return asc * (`${a.responsabile?.cognome ?? ""}`.localeCompare(`${b.responsabile?.cognome ?? ""}`));
      case "anno":
        return asc * (a.anno - b.anno);
      case "stato":
        return asc * (a.stato.localeCompare(b.stato));
      default:
        return 0;
    }
  });

  const shProps = { currentSort: sort, currentDir: dir };

  // Helper per costruire URL mantenendo i filtri attivi
  const filterHref = (overrides: Partial<SearchParams>) => {
    const p = { ...params, ...overrides };
    const qs = new URLSearchParams(
      Object.entries(p).filter(([, v]) => v !== undefined) as [string, string][]
    ).toString();
    return `/admin/valutazioni${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: "Valutazioni", href: "/valutazioni" }, { label: "Tutte le valutazioni" }]} />

        <div>
          <h1 className="font-tenorite text-3xl font-bold text-text">Valutazioni completate</h1>
          <p className="text-text-muted mt-1">Visualizza i risultati e scarica i certificati PDF per tutti gli utenti</p>
        </div>

        {/* Filtri */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-muted font-tenorite">Anno:</span>
            <div className="flex gap-1">
              <Link href={filterHref({ anno: undefined })}
                className={`px-3 py-1.5 rounded-lg text-xs font-tenorite border transition-colors ${!params.anno ? "bg-primary text-white border-primary" : "border-border text-text-muted hover:text-text hover:border-text-muted"}`}>
                Tutti
              </Link>
              {anni.map((a) => (
                <Link key={a} href={filterHref({ anno: String(a) })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-tenorite border transition-colors ${params.anno === String(a) ? "bg-primary text-white border-primary" : "border-border text-text-muted hover:text-text hover:border-text-muted"}`}>
                  {a}
                </Link>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-text-muted font-tenorite">Reparto:</span>
            <div className="flex flex-wrap gap-1">
              <Link href={filterHref({ reparto: undefined })}
                className={`px-3 py-1.5 rounded-lg text-xs font-tenorite border transition-colors ${!params.reparto ? "bg-primary text-white border-primary" : "border-border text-text-muted hover:text-text hover:border-text-muted"}`}>
                Tutti
              </Link>
              {reparti.map((r) => (
                <Link key={r} href={filterHref({ reparto: r })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-tenorite border transition-colors ${params.reparto === r ? "bg-primary text-white border-primary" : "border-border text-text-muted hover:text-text hover:border-text-muted"}`}>
                  {r}
                </Link>
              ))}
            </div>
          </div>

          <span className="text-sm text-text-muted ml-auto">{sessioniFiltrate.length} valutazioni</span>
        </div>

        {/* Tabella */}
        <div className="bg-bg rounded-xl border border-border overflow-hidden">
          {sessioniFiltrate.length === 0 ? (
            <div className="py-16 text-center text-text-muted text-sm">Nessuna valutazione completata trovata.</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-bg-page">
                  <th className="text-left px-4 py-3"><SortableHeader column="collaboratore" label="Collaboratore" {...shProps} /></th>
                  <th className="text-left px-4 py-3"><SortableHeader column="reparto" label="Reparto" {...shProps} /></th>
                  <th className="text-left px-4 py-3"><SortableHeader column="responsabile" label="Responsabile" {...shProps} /></th>
                  <th className="text-left px-4 py-3"><SortableHeader column="anno" label="Anno" {...shProps} /></th>
                  <th className="text-left px-4 py-3"><SortableHeader column="stato" label="Stato" {...shProps} /></th>
                  <th className="text-right px-4 py-3 text-xs font-tenorite text-text-muted uppercase tracking-wide">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {sessioniFiltrate.map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-0 hover:bg-bg-page/50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-text text-sm">{s.utente?.cognome} {s.utente?.nome}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-text-muted">{s.utente?.reparto ?? "—"}</td>
                    <td className="px-4 py-3 text-sm text-text-muted">
                      {s.responsabile ? `${s.responsabile.cognome} ${s.responsabile.nome}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-text font-tenorite">{s.anno}</td>
                    <td className="px-4 py-3">
                      <Badge variant={STATO_VARIANT[s.stato] ?? "outline"}>{STATO_LABEL[s.stato] ?? s.stato}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Link href={`/valutazioni/risultati/${s.id}`}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-tenorite border border-border text-text-muted hover:text-primary hover:border-primary transition-colors">
                          <ExternalLink className="w-3 h-3" />Risultati
                        </Link>
                        <a href={`/api/portali/valutazioni/certificato/${s.id}`} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-tenorite bg-primary hover:bg-primary-dark text-white transition-colors">
                          <FileDown className="w-3 h-3" />PDF
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
