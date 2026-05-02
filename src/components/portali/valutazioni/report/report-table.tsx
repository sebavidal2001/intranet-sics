"use client";

import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { TableRow as TableRowData } from "@/lib/types";

interface Props {
  rows: TableRowData[];
  colonne?: string[];
}

function formatLabel(key: string) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ReportTable({ rows, colonne }: Props) {
  if (rows.length === 0) {
    return <p className="text-center text-text-muted py-8 text-sm">Nessun dato disponibile.</p>;
  }

  const keys = colonne?.length ? colonne : Object.keys(rows[0]);

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {keys.map((k) => (
              <TableHead key={k}>{formatLabel(k)}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              {keys.map((k) => (
                <TableCell key={k} className={k === "posizione" ? "font-tenorite text-primary" : ""}>
                  {row[k] !== null && row[k] !== undefined ? String(row[k]) : "—"}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
