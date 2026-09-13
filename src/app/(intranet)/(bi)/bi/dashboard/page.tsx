import { DashboardList } from "@/components/prototipo-bi/dashboard-list";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dashboard — Prototipo BI (non in produzione)",
};

export default function PaginaDashboard() {
  return <DashboardList />;
}
