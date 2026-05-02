import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { aggiornaUtente } from "./actions";

export default async function ModificaUtentePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const isAdmin = await isValutazioniAdmin(supabase, user.id);
  if (!isAdmin) redirect("/");

  const db = createAdminClient();

  const { data: utente } = await db
    .from("utenti")
    .select("id, nome, cognome, email, ruolo, reparto, responsabile_id, stato")
    .eq("id", id)
    .single();

  if (!utente) redirect("/admin/utenti");

  const { data: tuttiUtenti } = await db
    .from("utenti")
    .select("id, nome, cognome")
    .neq("id", id)
    .order("cognome");

  const ruoli = [
    { value: "collaboratore", label: "Collaboratore" },
    { value: "responsabile", label: "Responsabile" },
    { value: "responsabile_intermedio", label: "Resp. Intermedio" },
    { value: "admin", label: "Admin" },
    { value: "amministratore", label: "Amministratore" },
  ];

  const action = aggiornaUtente.bind(null, id);

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Breadcrumbs items={[
        { label: "Valutazioni", href: "/valutazioni" },
        { label: "Utenti e Profili", href: "/admin/utenti" },
        { label: `${utente.nome} ${utente.cognome}` },
      ]} />

      <div className="mb-6">
        <h1 className="font-tenorite text-2xl font-bold text-text">
          Modifica Utente
        </h1>
        <p className="text-text-muted mt-1">
          {utente.email}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Dati anagrafici</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={action as (formData: FormData) => void} className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="nome">Nome</Label>
                <Input id="nome" name="nome" defaultValue={utente.nome} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cognome">Cognome</Label>
                <Input id="cognome" name="cognome" defaultValue={utente.cognome} required />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ruolo">Ruolo</Label>
              <select
                id="ruolo"
                name="ruolo"
                defaultValue={utente.ruolo}
                className="w-full h-10 rounded-md border border-border bg-bg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              >
                {ruoli.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reparto">Reparto</Label>
              <Input id="reparto" name="reparto" defaultValue={utente.reparto ?? ""} placeholder="Es. Produzione" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="responsabile_id">Responsabile</Label>
              <select
                id="responsabile_id"
                name="responsabile_id"
                defaultValue={utente.responsabile_id ?? ""}
                className="w-full h-10 rounded-md border border-border bg-bg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              >
                <option value="">— Nessun responsabile —</option>
                {(tuttiUtenti ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.cognome} {u.nome}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="stato">Stato</Label>
              <select
                id="stato"
                name="stato"
                defaultValue={utente.stato ?? "attivo"}
                className="w-full h-10 rounded-md border border-border bg-bg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              >
                <option value="attivo">Attivo</option>
                <option value="inattivo">Inattivo</option>
              </select>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" asChild>
                <a href="/admin/utenti">Annulla</a>
              </Button>
              <Button type="submit">Salva modifiche</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
