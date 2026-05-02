import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { creaUtente } from "./actions";

export default async function NuovoUtentePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const isAdmin = await isValutazioniAdmin(supabase, user.id);
  if (!isAdmin) redirect("/");

  const db = createAdminClient();
  const { data: tuttiUtenti } = await db
    .from("utenti")
    .select("id, nome, cognome")
    .order("cognome");

  const ruoli = [
    { value: "collaboratore", label: "Collaboratore" },
    { value: "responsabile", label: "Responsabile" },
    { value: "responsabile_intermedio", label: "Resp. Intermedio" },
    { value: "admin", label: "Admin" },
    { value: "amministratore", label: "Amministratore" },
  ];

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Breadcrumbs items={[
        { label: "Valutazioni", href: "/valutazioni" },
        { label: "Utenti e Profili", href: "/admin/utenti" },
        { label: "Nuovo Utente" },
      ]} />

      <div className="mb-6">
        <h1 className="font-tenorite text-2xl font-bold text-text">Nuovo Utente</h1>
        <p className="text-text-muted mt-1">Crea un nuovo account utente per la piattaforma.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Dati utente</CardTitle>
          <CardDescription>
            L&apos;utente riceverà le credenziali di accesso all&apos;email indicata.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={creaUtente as (formData: FormData) => void} className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="nome">Nome</Label>
                <Input id="nome" name="nome" required placeholder="Mario" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cognome">Cognome</Label>
                <Input id="cognome" name="cognome" required placeholder="Rossi" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required placeholder="mario.rossi@azienda.it" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password temporanea</Label>
              <Input id="password" name="password" type="password" required placeholder="Minimo 6 caratteri" />
              <p className="text-xs text-text-muted">L&apos;utente potrà cambiarla al primo accesso.</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ruolo">Ruolo</Label>
              <select
                id="ruolo"
                name="ruolo"
                defaultValue="collaboratore"
                className="w-full h-10 rounded-md border border-border bg-bg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              >
                {ruoli.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reparto">Reparto</Label>
              <Input id="reparto" name="reparto" placeholder="Es. Produzione" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="responsabile_id">Responsabile</Label>
              <select
                id="responsabile_id"
                name="responsabile_id"
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

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" asChild>
                <a href="/admin/utenti">Annulla</a>
              </Button>
              <Button type="submit">Crea utente</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
