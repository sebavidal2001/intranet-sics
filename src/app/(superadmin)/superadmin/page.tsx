import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Users, LayoutGrid, FileText, Shield, Building2 } from "lucide-react";

async function getSummary() {
  const supabase = await createClient();
  const [utenti, portali, blocks] = await Promise.all([
    supabase.from("utenti").select("id", { count: "exact", head: true }),
    supabase.from("portali").select("id", { count: "exact", head: true }),
    supabase.from("homepage_blocks").select("id", { count: "exact", head: true }),
  ]);
  return {
    utenti: utenti.count ?? 0,
    portali: portali.count ?? 0,
    blocks: blocks.count ?? 0,
  };
}

const cards = [
  {
    href: "/superadmin/utenti",
    icon: Users,
    label: "Utenti",
    desc: "Gestisci utenti, ruoli e credenziali",
    color: "#00a1be",
  },
  {
    href: "/superadmin/portali",
    icon: LayoutGrid,
    label: "Portali & permessi",
    desc: "Configura portali visibili e permessi per ruolo/utente",
    color: "#95c11f",
  },
  {
    href: "/superadmin/homepage",
    icon: FileText,
    label: "Contenuti homepage",
    desc: "Gestisci news e link rapidi della homepage",
    color: "#ee7326",
  },
  {
    href: "/superadmin/ruoli",
    icon: Shield,
    label: "Permessi portali",
    desc: "Panoramica permessi per portale e per ruolo",
    color: "#c82381",
  },
  {
    href: "/superadmin/ruoli-config",
    icon: Building2,
    label: "Ruoli & Reparti",
    desc: "Configura i ruoli aziendali e i reparti dell'organizzazione",
    color: "#f59e0b",
  },
];

export default async function SuperadminPage() {
  const summary = await getSummary();

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="font-tenorite text-3xl text-text">Superadmin</h1>
        <p className="text-text-muted mt-1">Configurazione globale dell&apos;intranet SICS</p>
      </div>

      {/* KPI rapidi */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Utenti totali", value: summary.utenti },
          { label: "Portali attivi", value: summary.portali },
          { label: "Blocchi homepage", value: summary.blocks },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-bg rounded-xl border border-border p-5 text-center">
            <p className="font-tenorite text-3xl text-primary">{kpi.value}</p>
            <p className="text-sm text-text-muted mt-1">{kpi.label}</p>
          </div>
        ))}
      </div>

      {/* Card sezioni */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="group flex items-start gap-4 p-5 bg-bg rounded-xl border border-border hover:shadow-card hover:-translate-y-0.5 transition-[transform,box-shadow] duration-150"
          >
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: `${card.color}20` }}
            >
              <card.icon className="w-5 h-5" style={{ color: card.color }} />
            </div>
            <div>
              <h3 className="font-tenorite text-base text-text group-hover:text-primary transition-colors">
                {card.label}
              </h3>
              <p className="text-sm text-text-muted mt-0.5">{card.desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
