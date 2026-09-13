import { DashboardView } from "@/components/prototipo-bi/dashboard-view";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dashboard — BI Direzionale",
};

export default async function PaginaDashboardAperta({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DashboardView dashboardId={id} />;
}
