import { DashboardList } from "@/components/prototipo-bi/dashboard-list";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dashboard — BI Direzionale",
};

export default function PaginaDashboard() {
  return <DashboardList />;
}
