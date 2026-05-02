import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getReport, calcolaDatiBlocco } from "@/lib/portali/valutazioni/services/report-service";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { ReportBlock } from "@/components/portali/valutazioni/report/report-block";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { Printer } from "lucide-react";

export default async function ReportViewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const result = await getReport(id);
  if (!result || !result.report.is_attivo) notFound();

  // Verify user can see this report via RLS — if getReport returned it, RLS passed.
  const { report, blocchi } = result;
  const dati = await Promise.all(blocchi.map((b) => calcolaDatiBlocco(b)));

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Breadcrumbs items={[
        { label: "Report", href: "/report" },
        { label: report.nome },
      ]} />

      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="font-tenorite text-2xl text-text">{report.nome}</h1>
          {report.descrizione && (
            <p className="text-text-muted text-sm mt-1">{report.descrizione}</p>
          )}
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link href={`/report/${id}/print`} target="_blank">
            <Printer className="w-4 h-4 mr-1.5" />
            Stampa PDF
          </Link>
        </Button>
      </div>

      {blocchi.length === 0 ? (
        <div className="bg-bg rounded-xl border border-border p-12 text-center">
          <p className="text-text-muted">Questo report non ha ancora contenuti.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {blocchi.map((blocco, i) => (
            <ReportBlock key={blocco.id} blocco={blocco} dati={dati[i]} />
          ))}
        </div>
      )}
    </div>
  );
}
