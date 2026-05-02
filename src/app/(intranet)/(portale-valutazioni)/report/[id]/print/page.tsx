import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getReport, calcolaDatiBlocco } from "@/lib/portali/valutazioni/services/report-service";
import { ReportBlock } from "@/components/portali/valutazioni/report/report-block";
import PrintTrigger from "@/app/(intranet)/(portale-valutazioni)/admin/report/[id]/print/print-trigger";

export default async function UserPrintReportPage({
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

  const { report, blocchi } = result;
  const dati = await Promise.all(blocchi.map((b) => calcolaDatiBlocco(b)));

  return (
    <>
      <style>{`
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="no-print mb-6 flex items-center justify-between">
          <div>
            <h1 className="font-tenorite text-xl text-text">{report.nome}</h1>
            {report.descrizione && <p className="text-text-muted text-sm mt-0.5">{report.descrizione}</p>}
          </div>
          <PrintTrigger />
        </div>

        <div className="hidden print:block mb-6">
          <h1 className="font-tenorite text-2xl text-text">{report.nome}</h1>
          {report.descrizione && <p className="text-text-muted text-sm mt-0.5">{report.descrizione}</p>}
        </div>

        <div className="space-y-6">
          {blocchi.map((blocco, i) => (
            <ReportBlock key={blocco.id} blocco={blocco} dati={dati[i]} />
          ))}
        </div>

        <div className="no-print mt-4 text-center text-xs text-text-muted">
          Esportato il {new Date().toLocaleDateString("it-IT")}
        </div>
      </div>
    </>
  );
}
