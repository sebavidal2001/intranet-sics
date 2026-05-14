import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Pencil, Trash2, UserCog, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { getSessionUser, getSessionIsAdmin } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { SortableHeader } from "@/components/ui/sortable-header";
import { parseSortParams } from "@/lib/sort-params";

const SORT_COLUMNS: Record<string, string> = {
  nome: "cognome",
  email: "email",
  ruolo: "ruolo",
  stato: "stato",
  reparto: "reparto",
};

const PAGE_SIZE = 25;

export default async function UtentiPage({
  searchParams,
}: {
  searchParams?: Promise<{ mostra_tutti?: string; sort?: string; dir?: string; page?: string }>;
}) {
  const [user, isAdmin] = await Promise.all([getSessionUser(), getSessionIsAdmin()]);
  if (!user) redirect("/auth/login");
  if (!isAdmin) redirect("/");

  await createClient(); // refresh session cookie
  const params = searchParams ? await searchParams : {};
  const mostraTutti = params?.mostra_tutti === "1";
  const { sort, dir } = parseSortParams(params ?? {}, "nome");
  const dbCol = SORT_COLUMNS[sort] ?? "cognome";
  const page = Math.max(1, parseInt(params?.page ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const sb = createAdminClient();
  let query = sb
    .from("utenti")
    .select("*", { count: "exact" })
    .order(dbCol, { ascending: dir === "asc" })
    .range(from, to);

  if (!mostraTutti) query = query.or("stato.eq.attivo,stato.is.null");

  const { data: utenti, count: totaleCount } = await query;

  // Fetch responsabili separatamente per evitare l'ambiguità della
  // relazione self-referencing in Supabase (che restituirebbe i
  // subordinati invece del capo).
  const responsabileIds = Array.from(
    new Set(
      (utenti ?? [])
        .map((u) => (u as { responsabile_id: string | null }).responsabile_id)
        .filter((id): id is string => Boolean(id))
    )
  );
  const { data: responsabili } = responsabileIds.length > 0
    ? await sb
        .from("utenti")
        .select("id, nome, cognome")
        .in("id", responsabileIds)
    : { data: [] };
  const responsabiliMap = new Map<string, { nome: string; cognome: string }>();
  for (const r of (responsabili ?? []) as { id: string; nome: string; cognome: string }[]) {
    responsabiliMap.set(r.id, { nome: r.nome, cognome: r.cognome });
  }

  const paginaCorrente = page;
  const totalePagine = Math.ceil((totaleCount ?? 0) / PAGE_SIZE);

  // Carica profili solo per gli utenti della pagina corrente
  const utenteIds = (utenti ?? []).map((u) => (u as { id: string }).id);
  const { data: profiliAssegnati } = utenteIds.length > 0
    ? await sb
        .from("utente_profili")
        .select("utente_id, ruolo_professionale:ruoli_professionali(id, nome)")
        .in("utente_id", utenteIds)
    : { data: [] };

  type UtenteRow = {
    id: string; nome: string; cognome: string; email: string;
    username: string | null; ruolo: string; stato: string | null;
    reparto: string | null; responsabile_id: string | null;
  };
  type ProfiloEntry = {
    utente_id: string;
    ruolo_professionale: { id: string; nome: string } | { id: string; nome: string }[] | null;
  };

  const profiliPerUtente = new Map<string, { id: string; nome: string }[]>();
  for (const p of (profiliAssegnati as ProfiloEntry[] ?? [])) {
    const rp = Array.isArray(p.ruolo_professionale) ? p.ruolo_professionale[0] : p.ruolo_professionale;
    if (!rp) continue;
    const lista = profiliPerUtente.get(p.utente_id) ?? [];
    lista.push(rp);
    profiliPerUtente.set(p.utente_id, lista);
  }

  const getRuoloBadge = (ruolo: string) => {
    const variants = { admin: "default", responsabile: "secondary", collaboratore: "outline" } as const;
    return variants[ruolo as keyof typeof variants] || "outline";
  };
  const getRuoloLabel = (ruolo: string) => {
    const labels: Record<string, string> = {
      superadmin: "Superadmin", amministratore: "Amministratore", admin: "Admin",
      responsabile: "Responsabile", responsabile_intermedio: "Resp. Intermedio", collaboratore: "Collaboratore",
    };
    return labels[ruolo] ?? ruolo;
  };

  const utentiTyped = (utenti ?? []) as UtenteRow[];
  const totaleUtenti = totaleCount ?? utentiTyped.length;

  const shProps = { currentSort: sort, currentDir: dir };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: "Valutazioni", href: "/valutazioni" }, { label: "Utenti e Profili" }]} />
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-tenorite text-3xl font-bold text-text">Gestione Utenti</h1>
            <p className="text-text-muted mt-1">
              {totaleUtenti} {mostraTutti ? "utenti totali" : "utenti attivi"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href={mostraTutti ? "/admin/utenti" : "/admin/utenti?mostra_tutti=1"}
              className="px-3 py-2 text-sm border border-border text-text-muted hover:text-text rounded-lg transition-colors"
            >
              {mostraTutti ? "Mostra solo attivi" : "Mostra tutti"}
            </Link>
            <Button asChild>
              <Link href="/admin/utenti/nuovo"><Plus className="mr-2 h-4 w-4" />Nuovo Utente</Link>
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader><CardTitle>Elenco Utenti</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead><SortableHeader column="nome" label="Nome" {...shProps} /></TableHead>
                  <TableHead><SortableHeader column="email" label="Email" {...shProps} /></TableHead>
                  <TableHead><SortableHeader column="ruolo" label="Ruolo" {...shProps} /></TableHead>
                  <TableHead><SortableHeader column="stato" label="Stato" {...shProps} /></TableHead>
                  <TableHead><SortableHeader column="reparto" label="Reparto" {...shProps} /></TableHead>
                  <TableHead>Responsabile</TableHead>
                  <TableHead>Profili</TableHead>
                  <TableHead className="text-right">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {utentiTyped.length > 0 ? utentiTyped.map((utente) => {
                  const profili = profiliPerUtente.get(utente.id) ?? [];
                  const isInattivo = utente.stato === "inattivo";
                  return (
                    <TableRow key={utente.id} className={isInattivo ? "opacity-60" : ""}>
                      <TableCell className="font-medium">{utente.nome} {utente.cognome}</TableCell>
                      <TableCell className="text-text-muted">{utente.username || utente.email}</TableCell>
                      <TableCell>
                        <Badge variant={getRuoloBadge(utente.ruolo)}>{getRuoloLabel(utente.ruolo)}</Badge>
                      </TableCell>
                      <TableCell>
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          isInattivo
                            ? "bg-secondary-light text-text-muted border border-border"
                            : "bg-success/10 text-success border border-success/30"
                        }`}>
                          {isInattivo ? "Inattivo" : "Attivo"}
                        </span>
                      </TableCell>
                      <TableCell>{utente.reparto}</TableCell>
                      <TableCell className="text-text-muted">
                        {(() => {
                          const resp = utente.responsabile_id
                            ? responsabiliMap.get(utente.responsabile_id)
                            : null;
                          return resp ? `${resp.nome} ${resp.cognome}` : "-";
                        })()}
                      </TableCell>
                      <TableCell>
                        {profili.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {profili.map((p) => (
                              <span key={p.id} className="inline-block rounded-full px-2 py-0.5 text-xs font-medium bg-primary-light text-primary">
                                {p.nome}
                              </span>
                            ))}
                          </div>
                        ) : <span className="text-xs text-text-muted">—</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="icon" asChild title="Permessi portali">
                            <Link href={`/admin/utenti/${utente.id}/permessi`}><ShieldCheck className="h-4 w-4" /></Link>
                          </Button>
                          <Button variant="ghost" size="icon" asChild title="Gestisci profilo">
                            <Link href={`/admin/utenti/${utente.id}/profilo`}><UserCog className="h-4 w-4" /></Link>
                          </Button>
                          <Button variant="ghost" size="icon" asChild>
                            <Link href={`/admin/utenti/${utente.id}`}><Pencil className="h-4 w-4" /></Link>
                          </Button>
                          <Button variant="ghost" size="icon" disabled={utente.ruolo === "admin"}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                }) : (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8">
                      <p className="text-text-muted">Nessun utente trovato</p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
          {totalePagine > 1 && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-border">
              <p className="text-sm text-text-muted">
                Pagina {paginaCorrente} di {totalePagine} · {totaleUtenti} utenti
              </p>
              <div className="flex items-center gap-2">
                {paginaCorrente > 1 && (
                  <Link
                    href={`/admin/utenti?${new URLSearchParams({ ...(mostraTutti ? { mostra_tutti: "1" } : {}), sort, dir, page: String(paginaCorrente - 1) }).toString()}`}
                    className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-bg-page transition-colors"
                  >
                    ← Precedente
                  </Link>
                )}
                {Array.from({ length: Math.min(5, totalePagine) }, (_, i) => {
                  const half = 2;
                  let start = Math.max(1, paginaCorrente - half);
                  const end = Math.min(totalePagine, start + 4);
                  start = Math.max(1, end - 4);
                  return start + i;
                }).map((p) => (
                  <Link
                    key={p}
                    href={`/admin/utenti?${new URLSearchParams({ ...(mostraTutti ? { mostra_tutti: "1" } : {}), sort, dir, page: String(p) }).toString()}`}
                    className={`px-3 py-1.5 text-sm border rounded-md transition-colors ${p === paginaCorrente ? "bg-primary text-white border-primary" : "border-border hover:bg-bg-page"}`}
                  >
                    {p}
                  </Link>
                ))}
                {paginaCorrente < totalePagine && (
                  <Link
                    href={`/admin/utenti?${new URLSearchParams({ ...(mostraTutti ? { mostra_tutti: "1" } : {}), sort, dir, page: String(paginaCorrente + 1) }).toString()}`}
                    className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-bg-page transition-colors"
                  >
                    Successiva →
                  </Link>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
