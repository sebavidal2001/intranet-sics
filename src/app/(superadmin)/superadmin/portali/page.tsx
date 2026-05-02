import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Plus, Key } from "lucide-react";
import { ToggleAttivoPortale } from "@/components/superadmin/toggle-attivo-portale";
import { SortableHeader } from "@/components/ui/sortable-header";
import { parseSortParams } from "@/lib/sort-params";

interface PortaleRow {
  id: string;
  nome: string;
  slug: string;
  icona: string | null;
  colore: string | null;
  ordine: number;
  is_attivo: boolean;
}

const DB_COL: Record<string, string> = {
  nome: "nome", slug: "slug", ordine: "ordine",
};

export default async function PortaliPage({
  searchParams,
}: {
  searchParams?: Promise<{ sort?: string; dir?: string }>;
}) {
  const params = searchParams ? await searchParams : {};
  const { sort, dir } = parseSortParams(params ?? {}, "ordine");

  const supabase = await createClient();

  let query = supabase
    .from("portali")
    .select("id, nome, slug, icona, colore, ordine, is_attivo");

  if (sort === "attivo") {
    // JS-sort: boolean not sortable via Supabase order
    query = query.order("ordine", { ascending: true });
  } else {
    query = query.order(DB_COL[sort] ?? "ordine", { ascending: dir === "asc" });
  }

  const { data, error } = await query;
  if (error) throw error;
  let portali = (data ?? []) as PortaleRow[];

  if (sort === "attivo") {
    const asc = dir === "asc" ? 1 : -1;
    portali = [...portali].sort((a, b) => asc * (Number(b.is_attivo) - Number(a.is_attivo)));
  }

  const shProps = { currentSort: sort, currentDir: dir };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-tenorite text-3xl text-text">Portali & permessi</h1>
          <p className="text-text-muted mt-1">Configura portali visibili e permessi per ruolo e utente</p>
        </div>
        <Link
          href="/superadmin/portali/nuovo"
          className="inline-flex items-center gap-2 bg-primary hover:bg-primary-dark text-white font-tenorite text-sm px-4 py-2.5 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nuovo portale
        </Link>
      </div>

      {/* Table card */}
      <div className="bg-bg rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-bg-page">
              <th className="text-left px-5 py-3"><SortableHeader column="nome" label="Nome" {...shProps} /></th>
              <th className="text-left px-5 py-3"><SortableHeader column="slug" label="Slug" {...shProps} /></th>
              <th className="text-left font-tenorite text-text-muted px-5 py-3">Icona</th>
              <th className="text-left font-tenorite text-text-muted px-5 py-3">Colore</th>
              <th className="text-center px-5 py-3"><SortableHeader column="ordine" label="Ordine" {...shProps} /></th>
              <th className="text-center px-5 py-3"><SortableHeader column="attivo" label="Attivo" {...shProps} /></th>
              <th className="text-right font-tenorite text-text-muted px-5 py-3">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {portali.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-10 text-center text-text-muted">
                  Nessun portale trovato.
                </td>
              </tr>
            )}
            {portali.map((p) => (
              <tr
                key={p.id}
                className="border-b border-border last:border-0 hover:bg-bg-page transition-colors"
              >
                <td className="px-5 py-3.5 font-tenorite text-text">{p.nome}</td>
                <td className="px-5 py-3.5 text-text-muted font-mono text-xs">{p.slug}</td>
                <td className="px-5 py-3.5 text-text-muted">{p.icona ?? "—"}</td>
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-4 h-4 rounded-full shrink-0 border border-border"
                      style={{ backgroundColor: p.colore ?? "#e2e8f0" }}
                    />
                    <span className="text-text-muted font-mono text-xs">
                      {p.colore ?? "—"}
                    </span>
                  </div>
                </td>
                <td className="px-5 py-3.5 text-center text-text-muted">{p.ordine}</td>
                <td className="px-5 py-3.5 text-center">
                  <ToggleAttivoPortale id={p.id} isAttivo={p.is_attivo} />
                </td>
                <td className="px-5 py-3.5 text-right">
                  <div className="inline-flex items-center gap-3">
                    <Link
                      href={`/superadmin/portali/${p.id}/permessi`}
                      className="inline-flex items-center gap-1 text-xs font-tenorite text-text-muted hover:text-primary transition-colors"
                    >
                      <Key className="w-3.5 h-3.5" />
                      Permessi
                    </Link>
                    <Link
                      href={`/superadmin/portali/${p.id}/modifica`}
                      className="text-primary hover:text-primary-dark text-xs font-tenorite transition-colors"
                    >
                      Modifica
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
