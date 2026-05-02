import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";
import { getTuttiReport } from "@/lib/portali/valutazioni/services/report-service";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, FileBarChart2, Eye, Pencil } from "lucide-react";
import Link from "next/link";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import DeleteReportButton from "./delete-report-button";
import ToggleAttivoReportButton from "./toggle-attivo-report-button";
import { SortableHeader } from "@/components/ui/sortable-header";
import { parseSortParams } from "@/lib/sort-params";

export default async function AdminReportPage({
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

  let reports = await getTuttiReport();

  // Ordinamento client-side
  const asc = dir === "asc" ? 1 : -1;
  reports = [...reports].sort((a, b) => {
    if (sort === "stato") return asc * (Number(b.is_attivo) - Number(a.is_attivo));
    return asc * a.nome.localeCompare(b.nome);
  });

  // Contiamo i blocchi per ogni report
  const { data: blocchiCount } = await supabase
    .from("report_blocchi")
    .select("report_id")
    .in("report_id", reports.map((r) => r.id));

  const countMap: Record<string, number> = {};
  (blocchiCount ?? []).forEach(({ report_id }) => {
    countMap[report_id] = (countMap[report_id] ?? 0) + 1;
  });

  const { data: ruoliRaw } = await supabase.from("ruoli_config").select("slug, nome, colore").order("ordine");
  const ruoli = (ruoliRaw ?? []) as { slug: string; nome: string; colore: string }[];
  const ruoloNome: Record<string, { nome: string; colore: string }> = {};
  ruoli.forEach((r) => { ruoloNome[r.slug] = { nome: r.nome, colore: r.colore }; });

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/config" }, { label: "Report" }]} />

      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-tenorite text-2xl text-text">Report Builder</h1>
          <p className="text-text-muted text-sm mt-1">{reports.length} report configurati</p>
        </div>
        <Button asChild>
          <Link href="/admin/report/nuovo">
            <Plus className="w-4 h-4 mr-2" />
            Nuovo report
          </Link>
        </Button>
      </div>

      {reports.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <FileBarChart2 className="w-12 h-12 text-text-muted mb-4" />
            <p className="font-tenorite text-lg text-text mb-2">Nessun report ancora</p>
            <p className="text-text-muted text-sm mb-6">
              Crea il tuo primo report con grafici personalizzati.
            </p>
            <Button asChild>
              <Link href="/admin/report/nuovo">
                <Plus className="w-4 h-4 mr-2" />
                Crea il primo report
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center gap-6 px-1 mb-2">
            <SortableHeader column="nome" label="Nome" currentSort={sort} currentDir={dir} />
            <SortableHeader column="stato" label="Stato" currentSort={sort} currentDir={dir} />
          </div>
          <div className="grid grid-cols-1 gap-4">
          {reports.map((report) => (
            <Card key={report.id} className={!report.is_attivo ? "opacity-60" : ""}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <CardTitle className="text-base truncate">{report.nome}</CardTitle>
                      {!report.is_attivo && (
                        <Badge variant="outline" className="text-xs shrink-0">Inattivo</Badge>
                      )}
                    </div>
                    {report.descrizione && (
                      <CardDescription className="text-sm line-clamp-2">{report.descrizione}</CardDescription>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <ToggleAttivoReportButton id={report.id} isAttivo={report.is_attivo} />
                    <Link
                      href={`/admin/report/${report.id}/modifica`}
                      className="p-2 text-text-muted hover:text-primary transition-colors rounded-lg hover:bg-primary/5"
                      title="Modifica"
                    >
                      <Pencil className="w-4 h-4" />
                    </Link>
                    <DeleteReportButton id={report.id} />
                    <Button asChild variant="default" size="sm" className="ml-2">
                      <Link href={`/admin/report/${report.id}`}>
                        <Eye className="w-3.5 h-3.5 mr-1.5" />
                        Visualizza
                      </Link>
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
                  <span className="flex items-center gap-1">
                    <FileBarChart2 className="w-3.5 h-3.5" />
                    {countMap[report.id] ?? 0} blocchi
                  </span>
                  {report.visibilita_ruoli.length > 0 ? (
                    <span className="flex items-center gap-1.5">
                      Visibile a:{" "}
                      {report.visibilita_ruoli.map((slug) => {
                        const r = ruoloNome[slug];
                        return (
                          <Badge
                            key={slug}
                            variant="outline"
                            className="text-xs"
                            style={r ? { borderColor: r.colore, color: r.colore } : undefined}
                          >
                            {r?.nome ?? slug}
                          </Badge>
                        );
                      })}
                    </span>
                  ) : (
                    <span className="text-text-muted italic">Nessun ruolo assegnato</span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
          </div>
        </>
      )}
    </div>
  );
}
