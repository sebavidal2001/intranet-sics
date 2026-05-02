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
import { Plus, Lock, Unlock, ClipboardList, Briefcase, Calendar, TrendingUp, FileCheck, Award, FileBarChart2 } from "lucide-react";
import Link from "next/link";
import DeleteParametroButton from "./delete-parametro-button";
import DeleteKpiButton from "./delete-kpi-button";
import { getSessionUser, getSessionIsAdmin } from "@/lib/auth/session";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";

export default async function ConfigPage() {
  const [user, isAdmin] = await Promise.all([
    getSessionUser(),
    getSessionIsAdmin(),
  ]);

  if (!user) redirect("/auth/login");
  if (!isAdmin) redirect("/");

  const supabase = await createClient();

  const { data: scale } = await supabase
    .from("scale_valutazione")
    .select("id, nome, min, max, labels")
    .order("created_at", { ascending: false });

  const { data: parametri } = await supabase
    .from("parametri_radar")
    .select("id, nome, colore, descrizione, ordine")
    .eq("is_storico", false)
    .order("ordine");

  const { data: sessioni } = await supabase
    .from("sessioni_valutazione")
    .select("*, scala:scale_valutazione(nome)")
    .order("anno", { ascending: false }) as unknown as { data: Array<{ id: string; anno: number; is_aperta: boolean; scala_id: string | null; created_at: string; updated_at: string; scala: { nome: string } | null }> | null };

  const { data: kpi } = await supabase
    .from("kpi_config")
    .select("*, parametro:parametri_radar(nome)")
    .order("created_at", { ascending: false }) as unknown as { data: Array<{ id: string; nome: string; operatore: string; soglia: number; anno: number | null; created_at: string; updated_at: string; parametro: { nome: string } | null }> | null };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="space-y-6">
        <Breadcrumbs items={[
          { label: "Valutazioni", href: "/valutazioni" },
          { label: "Configurazione" },
        ]} />
        {/* Header */}
        <div>
          <h1 className="font-tenorite text-3xl font-bold text-text">
            Configurazione
          </h1>
          <p className="text-text-muted mt-1">
            Gestisci scale, parametri radar, sessioni e KPI
          </p>
        </div>

        {/* Accessi rapidi */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Link
            href="/admin/config/profili"
            className="group flex items-center gap-4 p-5 bg-bg rounded-xl border border-border hover:shadow-card hover:-translate-y-0.5 transition-[transform,box-shadow] duration-150"
          >
            <div className="w-11 h-11 rounded-xl bg-primary-light flex items-center justify-center shrink-0">
              <Briefcase className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="font-tenorite text-base text-text group-hover:text-primary transition-colors">Profili professionali</h3>
              <p className="text-sm text-text-muted mt-0.5">Gestisci ruoli, mansioni, skills e import XLSX</p>
            </div>
          </Link>
          <Link
            href="/admin/calendario"
            className="group flex items-center gap-4 p-5 bg-bg rounded-xl border border-border hover:shadow-card hover:-translate-y-0.5 transition-[transform,box-shadow] duration-150"
          >
            <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: "#ee732620" }}>
              <Calendar className="w-5 h-5" style={{ color: "#ee7326" }} />
            </div>
            <div>
              <h3 className="font-tenorite text-base text-text group-hover:text-primary transition-colors">Calendario valutazioni</h3>
              <p className="text-sm text-text-muted mt-0.5">Pianifica e monitora le sessioni per utente</p>
            </div>
          </Link>
          <Link
            href="/admin/storico"
            className="group flex items-center gap-4 p-5 bg-bg rounded-xl border border-border hover:shadow-card hover:-translate-y-0.5 transition-[transform,box-shadow] duration-150"
          >
            <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: "#22c55e20" }}>
              <TrendingUp className="w-5 h-5" style={{ color: "#22c55e" }} />
            </div>
            <div>
              <h3 className="font-tenorite text-base text-text group-hover:text-primary transition-colors">Storico punteggi</h3>
              <p className="text-sm text-text-muted mt-0.5">Importa valutazioni anni precedenti</p>
            </div>
          </Link>
          <Link
            href="/admin/valutazioni"
            className="group flex items-center gap-4 p-5 bg-bg rounded-xl border border-border hover:shadow-card hover:-translate-y-0.5 transition-[transform,box-shadow] duration-150"
          >
            <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: "#22c55e20" }}>
              <FileCheck className="w-5 h-5" style={{ color: "#22c55e" }} />
            </div>
            <div>
              <h3 className="font-tenorite text-base text-text group-hover:text-primary transition-colors">Valutazioni completate</h3>
              <p className="text-sm text-text-muted mt-0.5">Visualizza risultati e scarica certificati PDF</p>
            </div>
          </Link>
          <Link
            href="/admin/config/certificato"
            className="group flex items-center gap-4 p-5 bg-bg rounded-xl border border-border hover:shadow-card hover:-translate-y-0.5 transition-[transform,box-shadow] duration-150"
          >
            <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: "#c8238120" }}>
              <Award className="w-5 h-5" style={{ color: "#c82381" }} />
            </div>
            <div>
              <h3 className="font-tenorite text-base text-text group-hover:text-primary transition-colors">Template certificato</h3>
              <p className="text-sm text-text-muted mt-0.5">Personalizza colori, testi e layout del PDF</p>
            </div>
          </Link>
          <Link
            href="/admin/report"
            className="group flex items-center gap-4 p-5 bg-bg rounded-xl border border-border hover:shadow-card hover:-translate-y-0.5 transition-[transform,box-shadow] duration-150"
          >
            <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: "#00a1be20" }}>
              <FileBarChart2 className="w-5 h-5" style={{ color: "#00a1be" }} />
            </div>
            <div>
              <h3 className="font-tenorite text-base text-text group-hover:text-primary transition-colors">Report Builder</h3>
              <p className="text-sm text-text-muted mt-0.5">Crea report con grafici, tabelle e KPI personalizzati</p>
            </div>
          </Link>
        </div>

        {/* Scale Valutazione */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Scale di Valutazione</CardTitle>
              <CardDescription>
                {scale?.length || 0} scale configurate
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/config/scale/nuova">
                <Plus className="mr-2 h-4 w-4" />
                Nuova Scala
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Range</TableHead>
                  <TableHead>Labels</TableHead>
                  <TableHead className="text-right">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scale && scale.length > 0 ? (
                  scale.map((scala) => (
                    <TableRow key={scala.id}>
                      <TableCell className="font-medium">{scala.nome}</TableCell>
                      <TableCell>
                        {scala.min} - {scala.max}
                      </TableCell>
                      <TableCell className="text-text-muted">
                        {Object.keys(scala.labels ?? {}).length} livelli
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/admin/config/scale/${scala.id}/modifica`}>
                            Modifica
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8">
                      <p className="text-text-muted">Nessuna scala configurata</p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Parametri Radar */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Parametri Radar</CardTitle>
              <CardDescription>
                {parametri?.length || 0} parametri attivi
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/config/parametri/nuovo">
                <Plus className="mr-2 h-4 w-4" />
                Nuovo Parametro
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {parametri && parametri.length > 0 ? (
                parametri.map((param) => (
                  <div
                    key={param.id}
                    className="flex items-center justify-between py-3 border-b border-border last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: param.colore }}
                      />
                      <div>
                        <p className="font-medium text-text">{param.nome}</p>
                        {param.descrizione && (
                          <p className="text-sm text-text-muted">
                            {param.descrizione}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">Ordine: {param.ordine}</Badge>
                      <Link
                        href={`/admin/config/parametri/${param.id}/modifica`}
                        className="p-1.5 text-text-muted hover:text-primary transition-colors rounded-lg hover:bg-primary-light"
                        title="Modifica parametro"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </Link>
                      <DeleteParametroButton id={param.id} />
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-center py-8 text-text-muted">
                  Nessun parametro configurato
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Sessioni Valutazione */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Sessioni Valutazione</CardTitle>
              <CardDescription>
                {sessioni?.length || 0} sessioni totali
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/config/sessioni/nuova">
                <Plus className="mr-2 h-4 w-4" />
                Nuova Sessione
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Anno</TableHead>
                  <TableHead>Scala</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead className="text-right">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessioni && sessioni.length > 0 ? (
                  sessioni.map((sessione) => (
                    <TableRow key={sessione.id}>
                      <TableCell className="font-medium">
                        {sessione.anno}
                      </TableCell>
                      <TableCell className="text-text-muted">
                        {sessione.scala?.nome || "Non assegnata"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={sessione.is_aperta ? "success" : "secondary"}
                        >
                          {sessione.is_aperta ? (
                            <>
                              <Unlock className="mr-1 h-3 w-3" />
                              Aperta
                            </>
                          ) : (
                            <>
                              <Lock className="mr-1 h-3 w-3" />
                              Chiusa
                            </>
                          )}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/admin/config/sessioni/${sessione.id}/domande`}>
                              <ClipboardList className="h-3.5 w-3.5 mr-1" />
                              Domande
                            </Link>
                          </Button>
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/admin/config/sessioni/${sessione.id}`}>
                              {sessione.is_aperta ? "Chiudi" : "Apri"}
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8">
                      <p className="text-text-muted">
                        Nessuna sessione configurata
                      </p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* KPI */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Configurazione KPI</CardTitle>
              <CardDescription>{kpi?.length || 0} KPI configurati</CardDescription>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/config/kpi/nuovo">
                <Plus className="mr-2 h-4 w-4" />
                Nuovo KPI
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Parametro</TableHead>
                  <TableHead>Condizione</TableHead>
                  <TableHead>Anno</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {kpi && kpi.length > 0 ? (
                  kpi.map((k) => (
                    <TableRow key={k.id}>
                      <TableCell className="font-medium">{k.nome}</TableCell>
                      <TableCell className="text-text-muted">
                        {(k as { parametro?: { nome: string } }).parametro?.nome || "Tutti"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {k.operatore} {k.soglia}
                        </Badge>
                      </TableCell>
                      <TableCell>{k.anno || "Tutti"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Link
                            href={`/admin/config/kpi/${k.id}/modifica`}
                            className="p-1.5 text-text-muted hover:text-primary transition-colors rounded-lg hover:bg-primary/5"
                            title="Modifica KPI"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </Link>
                          <DeleteKpiButton id={k.id} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8">
                      <p className="text-text-muted">Nessun KPI configurato</p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
