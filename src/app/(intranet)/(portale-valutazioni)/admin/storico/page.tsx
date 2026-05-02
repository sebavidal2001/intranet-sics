import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser, getSessionIsAdmin } from "@/lib/auth/session";
import ImportaStorico from "./importa-storico";
import { Trash2 } from "lucide-react";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { deleteStoricoPunteggio } from "./actions";
import { SortableHeader } from "@/components/ui/sortable-header";
import { parseSortParams } from "@/lib/sort-params";

interface StoricoPunteggio {
  id: string; utente_id: string; data_valutazione: string; anno: number;
  punteggio: number; tipo_fonte: string; note: string | null;
  utente: { nome: string; cognome: string; email: string } | null;
}

export default async function StoricoPunteggiPage({
  searchParams,
}: {
  searchParams?: Promise<{ sort?: string; dir?: string }>;
}) {
  const [user, isAdmin] = await Promise.all([getSessionUser(), getSessionIsAdmin()]);
  if (!user) redirect("/auth/login");
  if (!isAdmin) redirect("/");

  const params = searchParams ? await searchParams : {};
  const { sort, dir } = parseSortParams(params ?? {}, "data", "desc");

  await createClient(); // ensure session cookie is refreshed
  const sb = createAdminClient();

  // Colonne ordinabili direttamente in DB
  const DB_SORT: Record<string, string> = {
    data: "data_valutazione", anno: "anno", punteggio: "punteggio", fonte: "tipo_fonte",
  };

  const dbCol = DB_SORT[sort];
  let query = sb
    .from("storico_punteggi")
    .select("id, utente_id, data_valutazione, anno, punteggio, tipo_fonte, note, utente:utenti(nome, cognome, email)")
    .limit(200);

  if (dbCol) {
    query = query.order(dbCol, { ascending: dir === "asc" });
  } else {
    // "dipendente" — ordiniamo dopo in JS
    query = query.order("data_valutazione", { ascending: false });
  }

  let { data: storico } = await query;

  // Ordinamento per dipendente (join) — client-side
  if (sort === "dipendente" && storico) {
    const asc = dir === "asc" ? 1 : -1;
    storico = [...(storico as unknown as StoricoPunteggio[])].sort((a, b) => {
      const na = `${a.utente?.cognome ?? ""} ${a.utente?.nome ?? ""}`;
      const nb = `${b.utente?.cognome ?? ""} ${b.utente?.nome ?? ""}`;
      return asc * na.localeCompare(nb);
    }) as unknown as typeof storico;
  }

  const shProps = { currentSort: sort, currentDir: dir };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <Breadcrumbs items={[{ label: "Config", href: "/admin/config" }, { label: "Storico Punteggi" }]} />
      <div>
        <h1 className="font-tenorite text-3xl text-text">Storico Punteggi</h1>
        <p className="text-text-muted mt-1">Importa e gestisci i punteggi storici dei dipendenti</p>
      </div>

      <section className="bg-bg rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-4 border-b border-border bg-bg-page">
          <h2 className="font-tenorite text-base text-text">Importa da CSV</h2>
          <p className="text-xs text-text-muted mt-0.5">
            Formato CSV atteso: <strong>data_valutazione</strong> (GG/MM/AAAA o AAAA-MM-GG),{" "}
            <strong>email_dipendente</strong>, <strong>punteggio</strong>, <strong>note</strong> (opzionale)
          </p>
        </div>
        <div className="p-5"><ImportaStorico /></div>
      </section>

      <section className="bg-bg rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-4 border-b border-border bg-bg-page">
          <h2 className="font-tenorite text-base text-text">
            Storico esistente ({storico?.length ?? 0} record)
          </h2>
        </div>

        {!storico || storico.length === 0 ? (
          <div className="py-10 text-center text-sm text-text-muted">
            Nessun record storico. Importa dati con il modulo qui sopra.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-page">
                  <th className="text-left px-5 py-3"><SortableHeader column="dipendente" label="Dipendente" {...shProps} /></th>
                  <th className="text-left px-5 py-3"><SortableHeader column="data" label="Data" {...shProps} /></th>
                  <th className="text-left px-5 py-3"><SortableHeader column="anno" label="Anno" {...shProps} /></th>
                  <th className="text-left px-5 py-3"><SortableHeader column="punteggio" label="Punteggio" {...shProps} /></th>
                  <th className="text-left px-5 py-3"><SortableHeader column="fonte" label="Fonte" {...shProps} /></th>
                  <th className="text-left px-5 py-3 text-xs font-tenorite text-text-muted uppercase tracking-wide">Note</th>
                  <th className="text-right px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(storico as unknown as StoricoPunteggio[]).map((s) => (
                  <tr key={s.id} className="hover:bg-bg-page transition-colors">
                    <td className="px-5 py-3 font-medium text-text">
                      {s.utente ? `${s.utente.cognome} ${s.utente.nome}` : s.utente_id}
                    </td>
                    <td className="px-5 py-3 text-text-muted">
                      {new Date(s.data_valutazione).toLocaleDateString("it-IT")}
                    </td>
                    <td className="px-5 py-3 text-text-muted">{s.anno}</td>
                    <td className="px-5 py-3">
                      <span className="font-tenorite text-primary">{s.punteggio}</span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="inline-block rounded-full px-2 py-0.5 text-xs bg-secondary-light text-text-muted border border-border">
                        {s.tipo_fonte}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-text-muted text-xs max-w-[200px] truncate">{s.note ?? "—"}</td>
                    <td className="px-5 py-3 text-right">
                      <form action={async () => { "use server"; await deleteStoricoPunteggio(s.id); }}>
                        <button type="submit"
                          className="p-1.5 text-text-muted hover:text-danger rounded-lg transition-colors"
                          title="Elimina record">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
