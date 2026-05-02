import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ImportMansionari } from "@/components/portali/valutazioni/mansionari/import-mansionari";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";

export default async function MansionariPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const isAdmin = await isValutazioniAdmin(supabase, user.id);
  if (!isAdmin) {
    redirect("/");
  }

  const annoCorrente = new Date().getFullYear();

  const { data: mansionari } = await supabase
    .from("mansionari")
    .select("id, anno, utente:utenti(nome, cognome, reparto), mansione")
    .eq("anno", annoCorrente)
    .order("created_at", { ascending: false }) as unknown as { data: Array<{ id: string; anno: number; mansione: string; utente: { nome: string; cognome: string; reparto: string } | null }> | null };

  const totale = mansionari?.length || 0;
  const reparti = new Set(mansionari?.map((m) => m.utente?.reparto || "")).size;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="font-tenorite text-3xl font-bold text-text">
            Gestione Mansionari
          </h1>
          <p className="text-text-muted mt-1">
            Importa e gestisci i mansionari del personale
          </p>
        </div>

        {/* Stats */}
        <div className="grid gap-6 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm text-text-muted">
                Mansionari {annoCorrente}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-tenorite text-3xl font-bold text-text">
                {totale}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm text-text-muted">
                Reparti Coperti
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-tenorite text-3xl font-bold text-text">
                {reparti}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm text-text-muted">
                Anno Attivo
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-tenorite text-3xl font-bold text-primary">
                {annoCorrente}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Import */}
        <ImportMansionari anno={annoCorrente} />

        {/* Lista Mansionari */}
        {mansionari && mansionari.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Mansionari Caricati ({totale})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {mansionari.slice(0, 10).map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between py-3 border-b border-border last:border-0"
                  >
                    <div>
                      <p className="font-medium text-text">
                        {m.utente?.nome} {m.utente?.cognome}
                      </p>
                      <p className="text-sm text-text-muted">{m.mansione}</p>
                    </div>
                    <Badge variant="secondary">{m.utente?.reparto}</Badge>
                  </div>
                ))}
                {mansionari.length > 10 && (
                  <p className="text-sm text-text-muted text-center pt-4">
                    ... e altri {mansionari.length - 10}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
