"use client";

import { CheckCircle, XCircle, MinusCircle } from "lucide-react";
import type { KpiCardData } from "@/lib/types";

interface Props {
  items: KpiCardData[];
}

const statusConfig = {
  ok:  { icon: CheckCircle, color: "text-success", bg: "bg-success/10", label: "Raggiunto" },
  ko:  { icon: XCircle,     color: "text-danger",  bg: "bg-danger/10",  label: "Non raggiunto" },
  nd:  { icon: MinusCircle, color: "text-text-muted", bg: "bg-border/40", label: "Nessun dato" },
};

export function ReportKpiCard({ items }: Props) {
  if (items.length === 0) {
    return (
      <p className="text-center text-text-muted py-8 text-sm">Nessun KPI configurato.</p>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map((kpi) => {
        const { icon: Icon, color, bg, label } = statusConfig[kpi.status];
        return (
          <div key={kpi.id} className={`rounded-xl border border-border p-4 ${bg}`}>
            <div className="flex items-start justify-between gap-2 mb-3">
              <p className="font-tenorite text-sm text-text leading-tight">{kpi.nome}</p>
              <Icon className={`w-5 h-5 flex-shrink-0 ${color}`} />
            </div>
            <div className="flex items-end justify-between">
              <div>
                <p className="font-tenorite text-2xl text-text">
                  {kpi.valore !== null ? kpi.valore.toFixed(1) : "—"}
                </p>
                <p className="text-xs text-text-muted mt-0.5">
                  Soglia: {kpi.operatore} {kpi.soglia}
                </p>
              </div>
              <span className={`text-xs font-tenorite px-2 py-1 rounded-full ${color} ${bg}`}>
                {label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
