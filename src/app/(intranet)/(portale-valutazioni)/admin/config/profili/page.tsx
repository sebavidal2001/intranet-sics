import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Plus, Upload, ChevronRight, Briefcase } from "lucide-react";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";
import { SortableHeader } from "@/components/ui/sortable-header";
import { parseSortParams } from "@/lib/sort-params";
import { PORTALE_SLUGS } from "@/lib/config/portali";

export default async function ProfiliPage({
  searchParams,
}: {
  searchParams?: Promise<{ sort?: string; dir?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const isAdmin = await isValutazioniAdmin(supabase, user.id);
  if (!isAdmin) redirect("/");

  const params = searchParams ? await searchParams : {};
  const { sort, dir } = parseSortParams(params ?? {}, "nome");

  const { data: portale } = await supabase.from("portali").select("id").eq("slug", PORTALE_SLUGS.VALUTAZIONI).single();

  const { data: ruoli } = portale
    ? await supabase
        .from("ruoli_professionali")
        .select("id, nome, descrizione, mansioni(id)")
        .eq("portale_id", portale.id)
        .order("nome")
    : { data: null };

  // Ordinamento client-side (mansioni è un conteggio calcolato)
  let ruoliOrdinati = [...(ruoli ?? [])];
  const asc = dir === "asc" ? 1 : -1;
  if (sort === "mansioni") {
    ruoliOrdinati.sort((a, b) => {
      const ca = Array.isArray(a.mansioni) ? a.mansioni.length : 0;
      const cb = Array.isArray(b.mansioni) ? b.mansioni.length : 0;
      return asc * (ca - cb);
    });
  } else {
    // nome (default) — già ordinato dal DB, ma rispettiamo dir
    if (dir === "desc") ruoliOrdinati.reverse();
  }

  const shProps = { currentSort: sort, currentDir: dir };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <Link href="/admin/config"
          className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-primary transition-colors mb-4">
          <ChevronRight className="w-4 h-4 rotate-180" />
          Torna alla configurazione
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-tenorite text-2xl text-text">Profili Professionali</h1>
            <p className="text-text-muted text-sm mt-1">
              Gestisci i ruoli professionali e le relative mansioni per il sistema di valutazione.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/admin/config/profili/importa-skills"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm border border-border text-text-muted hover:text-text hover:border-text-muted transition-colors">
              <Upload className="w-4 h-4" />Importa Skills
            </Link>
            <Link href="/admin/config/profili/importa"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm border border-border text-text-muted hover:text-text hover:border-text-muted transition-colors">
              <Upload className="w-4 h-4" />Importa Mansioni
            </Link>
            <Link href="/admin/config/profili/nuovo"
              className="inline-flex items-center gap-2 bg-primary hover:bg-primary-dark text-white font-tenorite px-4 py-2 rounded-lg text-sm transition-colors">
              <Plus className="w-4 h-4" />Nuovo profilo
            </Link>
          </div>
        </div>
      </div>

      <div className="bg-bg rounded-xl border border-border overflow-hidden">
        {/* Intestazione ordinabile */}
        <div className="grid grid-cols-[1fr_auto] px-4 py-2.5 border-b border-border bg-bg-page">
          <SortableHeader column="nome" label="Nome profilo" {...shProps} />
          <SortableHeader column="mansioni" label="Mansioni" {...shProps} />
        </div>

        {ruoliOrdinati.length === 0 ? (
          <div className="py-16 text-center">
            <Briefcase className="w-10 h-10 text-text-muted/30 mx-auto mb-3" />
            <p className="font-tenorite text-text mb-1">Nessun profilo professionale</p>
            <p className="text-sm text-text-muted mb-4">
              Crea il primo profilo professionale oppure importa da file XLSX.
            </p>
            <div className="flex items-center justify-center gap-3">
              <Link href="/admin/config/profili/nuovo"
                className="inline-flex items-center gap-2 bg-primary hover:bg-primary-dark text-white font-tenorite px-4 py-2 rounded-lg text-sm transition-colors">
                <Plus className="w-4 h-4" />Crea profilo
              </Link>
              <Link href="/admin/config/profili/importa"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm border border-border text-text-muted hover:text-text transition-colors">
                <Upload className="w-4 h-4" />Importa XLSX
              </Link>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {ruoliOrdinati.map((ruolo) => {
              const mansioniCount = Array.isArray(ruolo.mansioni) ? ruolo.mansioni.length : 0;
              return (
                <Link key={ruolo.id} href={`/admin/config/profili/${ruolo.id}`}
                  className="flex items-center justify-between px-4 py-4 hover:bg-bg-page transition-colors group">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-primary-light flex items-center justify-center shrink-0">
                      <Briefcase className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-tenorite text-text group-hover:text-primary transition-colors">{ruolo.nome}</p>
                      {ruolo.descrizione && (
                        <p className="text-xs text-text-muted mt-0.5 line-clamp-1">{ruolo.descrizione}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-text-muted bg-secondary-light px-2.5 py-1 rounded-full">
                      {mansioniCount} {mansioniCount === 1 ? "mansione" : "mansioni"}
                    </span>
                    <ChevronRight className="w-4 h-4 text-text-muted group-hover:text-primary transition-colors" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
