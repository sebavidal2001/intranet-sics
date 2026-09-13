import { DashboardView } from "@/components/prototipo-bi/dashboard-view";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dashboard — Prototipo BI (non in produzione)",
};

export default async function PaginaDashboardAperta({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DashboardView dashboardId={id} />;
}
