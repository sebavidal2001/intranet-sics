import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  Lock,
  AlertCircle,
  Eye,
  ClipboardList,
  UserCheck,
  Settings,
  CalendarDays,
  Users,
  History,
  Wrench,
} from "lucide-react";
import type { StatoSessioneUtente } from "@/lib/types";
import { STATO_SESSIONE_LABELS } from "@/lib/types";
import { getSessionUser, getSessionProfile, getSessionIsAdmin } from "@/lib/auth/session";
import { avviaSessioneResponsabile } from "./actions";

interface SessioneConUtente {
  id: string;
  anno: number;
  stato: StatoSessioneUtente;
  data_programmata: string | null;
  utente: {
    id: string;
    nome: string;
    cognome: string;
    reparto: string;
  };
}

function StatoBadge({ stato }: { stato: StatoSessioneUtente }) {
  const variantMap: Record<
    StatoSessioneUtente,
    "default" | "secondary" | "success" | "warning" | "danger" | "outline"
  > = {
    programmata: "secondary",
    resp_in_corso: "warning",
    resp_completata: "default",
    collab_in_corso: "warning",
    completata: "success",
    certificata: "success",
  };
  return (
    <Badge variant={variantMap[stato]}>{STATO_SESSIONE_LABELS[stato]}</Badge>
  );
}

export default async function ValutazioniPage() {
  const user = await getSessionUser();
  if (!user) redirect("/auth/login");

  const [userProfile, isAdmin] = await Promise.all([
    getSessionProfile(),
    getSessionIsAdmin(),
  ]);

  if (!userProfile) redirect("/auth/login");

  const supabase = await createClient();

  // Admin possono anche fare valutazioni proprie — non redirect al calendario
  const isResponsabile =
    isAdmin ||
    userProfile.ruolo === "responsabile" ||
    ((userProfile as unknown as { ruoli_aggiuntivi?: string[] }).ruoli_aggiuntivi ?? []).includes("responsabile");

  // ---- Sessioni come collaboratore ----
  const { data: sessioniCollaboratore } = await supabase
    .from("sessioni_utente")
    .select(
      `
      id,
      anno,
      stato,
      data_programmata
    `
    )
    .eq("utente_id", user.id)
    .order("anno", { ascending: false });

  // ---- Sessioni come responsabile ----
  let sessioniResponsabile: SessioneConUtente[] = [];

  if (isResponsabile) {
    const { data } = await supabase
      .from("sessioni_utente")
      .select(
        `
        id,
        anno,
        stato,
        data_programmata,
        utente:utenti!sessioni_utente_utente_id_fkey(id, nome, cognome, reparto)
      `
      )
      .eq("responsabile_id", user.id)
      .order("anno", { ascending: false });

    if (data) {
      sessioniResponsabile = data as unknown as SessioneConUtente[];
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="space-y-8">
        {/* Header */}
        <div>
          <h1 className="font-tenorite text-3xl font-bold text-text">
            Valutazioni
          </h1>
          <p className="text-text-muted mt-1">
            Gestisci le valutazioni di performance
          </p>
        </div>

        {/* ========== SEZIONE COLLABORATORE ========== */}
        <section className="space-y-4">
          <h2 className="font-tenorite text-xl font-semibold text-text flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            Le mie valutazioni
          </h2>

          {!sessioniCollaboratore || sessioniCollaboratore.length === 0 ? (
            <Card>
              <CardContent className="flex items-center gap-4 py-8">
                <Lock className="h-8 w-8 text-text-muted shrink-0" />
                <div>
                  <p className="font-tenorite text-lg text-text">
                    Nessuna valutazione programmata
                  </p>
                  <p className="text-sm text-text-muted">
                    Le valutazioni verranno pianificate dall&apos;amministratore
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {sessioniCollaboratore.map((sessione) => {
                const stato = sessione.stato as StatoSessioneUtente;

                let actionButton: React.ReactNode = null;
                let statusMessage: React.ReactNode = null;

                if (stato === "programmata") {
                  statusMessage = (
                    <p className="text-sm text-text-muted flex items-center gap-1.5">
                      <Clock className="h-4 w-4" />
                      In attesa di apertura da parte dell&apos;amministratore
                    </p>
                  );
                } else if (stato === "resp_in_corso") {
                  statusMessage = (
                    <p className="text-sm text-text-muted flex items-center gap-1.5">
                      <Clock className="h-4 w-4 text-warning" />
                      In attesa che il tuo responsabile completi la valutazione
                    </p>
                  );
                } else if (
                  stato === "resp_completata" ||
                  stato === "collab_in_corso"
                ) {
                  actionButton = (
                    <Button asChild>
                      <Link href={`/valutazioni/auto/${sessione.id}`}>
                        Compila autovalutazione
                      </Link>
                    </Button>
                  );
                } else if (stato === "completata" || stato === "certificata") {
                  actionButton = (
                    <Button asChild variant="outline">
                      <Link href={`/valutazioni/risultati/${sessione.id}`}>
                        <Eye className="h-4 w-4 mr-2" />
                        Visualizza risultati
                      </Link>
                    </Button>
                  );
                }

                return (
                  <Card key={sessione.id} className="card-hover">
                    <CardContent className="flex items-center justify-between py-5 gap-4">
                      <div className="flex items-center gap-4 min-w-0">
                        {stato === "completata" || stato === "certificata" ? (
                          <CheckCircle2 className="h-6 w-6 text-success shrink-0" />
                        ) : stato === "resp_completata" ||
                          stato === "collab_in_corso" ? (
                          <AlertCircle className="h-6 w-6 text-warning shrink-0" />
                        ) : (
                          <Clock className="h-6 w-6 text-text-muted shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="font-tenorite text-base font-semibold text-text">
                            Valutazione {sessione.anno}
                          </p>
                          {statusMessage}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <StatoBadge stato={stato} />
                        {actionButton}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        {/* ========== SEZIONE AMMINISTRAZIONE (solo admin) ========== */}
        {isAdmin && (
          <section className="space-y-4">
            <h2 className="font-tenorite text-xl font-semibold text-text flex items-center gap-2">
              <Settings className="h-5 w-5 text-primary" />
              Amministrazione
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Link
                href="/admin/calendario"
                className="group flex flex-col items-start gap-2 p-4 rounded-xl border border-border bg-bg hover:border-primary/40 hover:bg-primary-light/30 transition-all duration-150"
              >
                <CalendarDays className="h-5 w-5 text-primary" />
                <div>
                  <p className="font-tenorite text-sm text-text group-hover:text-primary transition-colors">
                    Sessioni & Calendario
                  </p>
                  <p className="text-xs text-text-muted mt-0.5">
                    Pianifica e gestisci le valutazioni
                  </p>
                </div>
              </Link>
              <Link
                href="/admin/config"
                className="group flex flex-col items-start gap-2 p-4 rounded-xl border border-border bg-bg hover:border-primary/40 hover:bg-primary-light/30 transition-all duration-150"
              >
                <Wrench className="h-5 w-5 text-primary" />
                <div>
                  <p className="font-tenorite text-sm text-text group-hover:text-primary transition-colors">
                    Configurazione
                  </p>
                  <p className="text-xs text-text-muted mt-0.5">
                    Scale, parametri radar, KPI
                  </p>
                </div>
              </Link>
              <Link
                href="/admin/utenti"
                className="group flex flex-col items-start gap-2 p-4 rounded-xl border border-border bg-bg hover:border-primary/40 hover:bg-primary-light/30 transition-all duration-150"
              >
                <Users className="h-5 w-5 text-primary" />
                <div>
                  <p className="font-tenorite text-sm text-text group-hover:text-primary transition-colors">
                    Utenti & Profili
                  </p>
                  <p className="text-xs text-text-muted mt-0.5">
                    Profili professionali, mansioni
                  </p>
                </div>
              </Link>
              <Link
                href="/admin/storico"
                className="group flex flex-col items-start gap-2 p-4 rounded-xl border border-border bg-bg hover:border-primary/40 hover:bg-primary-light/30 transition-all duration-150"
              >
                <History className="h-5 w-5 text-primary" />
                <div>
                  <p className="font-tenorite text-sm text-text group-hover:text-primary transition-colors">
                    Storico
                  </p>
                  <p className="text-xs text-text-muted mt-0.5">
                    Importa anni precedenti
                  </p>
                </div>
              </Link>
            </div>
          </section>
        )}

        {/* ========== SEZIONE RESPONSABILE ========== */}
        {isResponsabile && (
          <section className="space-y-4">
            <h2 className="font-tenorite text-xl font-semibold text-text flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-primary" />
              Valutazioni dei miei collaboratori
            </h2>

            {sessioniResponsabile.length === 0 ? (
              <Card>
                <CardContent className="flex items-center gap-4 py-8">
                  <Lock className="h-8 w-8 text-text-muted shrink-0" />
                  <div>
                    <p className="font-tenorite text-lg text-text">
                      Nessun collaboratore da valutare
                    </p>
                    <p className="text-sm text-text-muted">
                      Non ci sono sessioni di valutazione assegnate a te come
                      responsabile
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3">
                {sessioniResponsabile.map((sessione) => {
                  const stato = sessione.stato as StatoSessioneUtente;
                  const utente = sessione.utente;

                  // Salta sessioni con utente null (join non riuscita per RLS o dato mancante)
                  if (!utente) return null;

                  const canAvvia = stato === "programmata";
                  const canValuta = stato === "resp_in_corso";
                  const canRivediForm =
                    stato === "resp_completata" || stato === "collab_in_corso";
                  const canRivediRisultati =
                    stato === "completata" || stato === "certificata";
                  const canRivedi = canRivediForm || canRivediRisultati;

                  return (
                    <Card key={sessione.id} className="card-hover">
                      <CardContent className="flex items-center justify-between py-5 gap-4">
                        <div className="flex items-center gap-4 min-w-0">
                          {canValuta ? (
                            <Clock className="h-6 w-6 text-warning shrink-0" />
                          ) : canRivedi ? (
                            <CheckCircle2 className="h-6 w-6 text-success shrink-0" />
                          ) : (
                            <Clock className="h-6 w-6 text-text-muted shrink-0" />
                          )}
                          <div className="min-w-0">
                            <p className="font-tenorite text-base font-semibold text-text">
                              {utente.nome} {utente.cognome}
                            </p>
                            <p className="text-sm text-text-muted">
                              {utente.reparto} &middot; Anno {sessione.anno}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <StatoBadge stato={stato} />
                          {canAvvia && (
                            <form
                              action={async () => {
                                "use server";
                                await avviaSessioneResponsabile(sessione.id);
                              }}
                            >
                              <Button type="submit">
                                Avvia valutazione
                              </Button>
                            </form>
                          )}
                          {canValuta && (
                            <Button asChild>
                              <Link
                                href={`/valutazioni/responsabile/${sessione.id}`}
                              >
                                Valuta
                              </Link>
                            </Button>
                          )}
                          {canRivediRisultati && (
                            <Button asChild variant="outline">
                              <Link href={`/valutazioni/risultati/${sessione.id}`}>
                                <Eye className="h-4 w-4 mr-2" />
                                Risultati
                              </Link>
                            </Button>
                          )}
                          {canRivediForm && (
                            <Button asChild variant="outline">
                              <Link href={`/valutazioni/responsabile/${sessione.id}`}>
                                <Eye className="h-4 w-4 mr-2" />
                                Rivedi
                              </Link>
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
