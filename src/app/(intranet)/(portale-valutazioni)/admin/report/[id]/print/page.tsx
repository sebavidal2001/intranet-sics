import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";
import { getReport, calcolaDatiBlocco } from "@/lib/portali/valutazioni/services/report-service";
import { ReportBlock } from "@/components/portali/valutazioni/report/report-block";
import PrintTrigger from "./print-trigger";

export default async function PrintReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const isAdmin = await isValutazioniAdmin(supabase, user.id);
  if (!isAdmin) redirect("/");

  const result = await getReport(id);
  if (!result) notFound();

  const { report, blocchi } = result;
  const dati = await Promise.all(blocchi.map((b) => calcolaDatiBlocco(b)));

  return (
    <>
      <style>{`
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
          .print-page { padding: 0 !important; }
        }
      `}</style>

      <div className="print-page max-w-5xl mx-auto px-6 py-8">
        <div className="no-print mb-6 flex items-center justify-between">
          <div>
            <h1 className="font-tenorite text-xl text-text">{report.nome}</h1>
            {report.descrizione && <p className="text-text-muted text-sm mt-0.5">{report.descrizione}</p>}
          </div>
          <PrintTrigger />
        </div>

        <div className="print:block">
          <h1 className="hidden print:block font-tenorite text-2xl text-text mb-1">{report.nome}</h1>
          {report.descrizione && (
            <p className="hidden print:block text-text-muted text-sm mb-6">{report.descrizione}</p>
          )}
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
