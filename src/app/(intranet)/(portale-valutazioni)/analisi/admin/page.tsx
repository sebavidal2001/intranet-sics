import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Download, BarChart3, TrendingUp, Users } from "lucide-react";
import Link from "next/link";
import { getSessionUser, getSessionIsAdmin } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { SortableHeader } from "@/components/ui/sortable-header";
import { parseSortParams } from "@/lib/sort-params";

export default async function AnalisiAdminPage({
  searchParams,
}: {
  searchParams?: Promise<{ sort?: string; dir?: string }>;
}) {
  const params = searchParams ? await searchParams : {};
  const { sort, dir } = parseSortParams(params ?? {}, "media", "desc");

  const [user, isAdmin] = await Promise.all([
    getSessionUser(),
    getSessionIsAdmin(),
  ]);

  if (!user) redirect("/auth/login");
  if (!isAdmin) redirect("/");

  const supabase = await createClient();

  const annoCorrente = new Date().getFullYear();

  const { data: utenti } = await supabase.from("utenti").select("id, reparto");

  type RispostaConRelazioni = {
    punteggio: number;
    sessione_utente: {
      anno: number;
      utente: { reparto: string } | null;
    } | null;
  };

  const adminClient = createAdminClient();
  const { data: risposteRaw } = await adminClient
    .from("risposte_valutazione")
    .select(`
      punteggio,
      sessione_utente:sessioni_utente!risposte_valutazione_sessione_utente_id_fkey(
        anno,
        utente:utenti!sessioni_utente_utente_id_fkey(reparto)
      )
    `)
    .eq("tipo", "responsabile");

  const risposte = (risposteRaw ?? []) as unknown as RispostaConRelazioni[];
  const valutazioniAnnoCorrente = risposte.filter((v) => v.sessione_utente?.anno === annoCorrente);

  const reparti = [...new Set(utenti?.map((u) => u.reparto) || [])];
  const mediaPerReparto = reparti.map((reparto) => {
    const valutazioniReparto = valutazioniAnnoCorrente.filter(
      (v) => v.sessione_utente?.utente?.reparto === reparto
    );

    const media = valutazioniReparto.length > 0
      ? valutazioniReparto.reduce((sum, v) => sum + v.punteggio, 0) /
        valutazioniReparto.length
      : 0;

    return {
      reparto,
      media: Math.round(media * 10) / 10,
      totale: valutazioniReparto?.length || 0,
    };
  });

  // Ordinamento in base ai searchParams
  const asc = dir === "asc" ? 1 : -1;
  mediaPerReparto.sort((a, b) => {
    switch (sort) {
      case "reparto": return asc * a.reparto.localeCompare(b.reparto);
      case "totale":  return asc * (a.totale - b.totale);
      default:        return asc * (a.media - b.media); // "media"
    }
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-tenorite text-3xl font-bold text-text">
              Analisi Admin
            </h1>
            <p className="text-text-muted mt-1">
              Dashboard aggregata e export dati per Power BI
            </p>
          </div>
          <Button asChild>
            <Link href="/api/export/powerbi">
              <Download className="mr-2 h-4 w-4" />
              Export Power BI
            </Link>
          </Button>
        </div>

        {/* KPI Cards */}
        <div className="grid gap-6 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-text-muted">
                Totale Utenti
              </CardTitle>
              <Users className="h-4 w-4 text-text-muted" />
            </CardHeader>
            <CardContent>
              <div className="font-tenorite text-2xl font-bold text-text">
                {utenti?.length || 0}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-text-muted">
                Reparti
              </CardTitle>
              <BarChart3 className="h-4 w-4 text-text-muted" />
            </CardHeader>
            <CardContent>
              <div className="font-tenorite text-2xl font-bold text-text">
                {reparti.length}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-text-muted">
                Valutazioni {annoCorrente}
              </CardTitle>
              <TrendingUp className="h-4 w-4 text-text-muted" />
            </CardHeader>
            <CardContent>
              <div className="font-tenorite text-2xl font-bold text-text">
                {valutazioniAnnoCorrente?.length || 0}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-text-muted">
                Media Globale
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-tenorite text-2xl font-bold text-primary">
                {valutazioniAnnoCorrente && valutazioniAnnoCorrente.length > 0
                  ? (
                      valutazioniAnnoCorrente.reduce(
                        (sum, v) => sum + v.punteggio,
                        0
                      ) / valutazioniAnnoCorrente.length
                    ).toFixed(1)
                  : "0.0"}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Medie per Reparto */}
        <Card>
          <CardHeader>
            <CardTitle>Performance per Reparto</CardTitle>
            <CardDescription>
              Medie valutazioni responsabile per reparto
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead><SortableHeader column="reparto" label="Reparto" currentSort={sort} currentDir={dir} /></TableHead>
                  <TableHead><SortableHeader column="media" label="Media Valutazioni" currentSort={sort} currentDir={dir} /></TableHead>
                  <TableHead><SortableHeader column="totale" label="N° Valutazioni" currentSort={sort} currentDir={dir} /></TableHead>
                  <TableHead className="text-right">Rating</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mediaPerReparto.length > 0 ? (
                  mediaPerReparto.map((r, idx) => (
                    <TableRow key={r.reparto}>
                      <TableCell className="font-medium">{r.reparto}</TableCell>
                      <TableCell>
                        <span className="font-tenorite text-lg text-text">
                          {r.media.toFixed(1)}
                        </span>
                        <span className="text-text-muted text-sm"> / 5.0</span>
                      </TableCell>
                      <TableCell className="text-text-muted">
                        {r.totale} valutazioni
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant={
                            idx === 0
                              ? "success"
                              : idx < 3
                              ? "secondary"
                              : "outline"
                          }
                        >
                          {idx === 0 ? "Top" : `#${idx + 1}`}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8">
                      <p className="text-text-muted">Nessun dato disponibile</p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Export Info */}
        <Card className="bg-primary-light border-primary/20">
          <CardHeader>
            <CardTitle className="text-primary">Export Power BI</CardTitle>
            <CardDescription className="text-text-muted">
              Formato CSV flat per integrazione diretta con Power BI
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-text-muted">
            <p>
              <strong>Colonne incluse:</strong> anno, utente_email, utente_nome,
              utente_cognome, reparto, parametro, punteggio_auto,
              punteggio_responsabile, delta
            </p>
            <p>
              <strong>Formato:</strong> Una riga per ogni combinazione
              utente/parametro/anno
            </p>
            <p>
              <strong>Filtri disponibili:</strong> Anno, reparto, responsabile,
              parametro
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
