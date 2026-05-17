import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import AllineaEmailClient from "./allinea-email-client";

export default async function AllineaEmailPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("utenti")
    .select("ruolo")
    .eq("id", user.id)
    .single();
  if (profile?.ruolo !== "superadmin") redirect("/");

  const sb = createAdminClient();
  const { data: utenti } = await sb
    .from("utenti")
    .select("id, nome, cognome, username, email")
    .order("cognome");

  type Row = { id: string; nome: string; cognome: string; username: string | null; email: string | null };
  const all = (utenti ?? []) as Row[];

  // Riga "da allineare": email vuota oppure email@sics.interno legacy.
  // (NB: include anche gli utenti che hanno già email reale @s-ics.com → quelli vengono filtrati)
  const daAllineare = all.filter((u) => {
    const e = (u.email ?? "").toLowerCase();
    return !e || e.endsWith("@sics.interno");
  });

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Breadcrumbs items={[
        { label: "Superadmin", href: "/superadmin" },
        { label: "Utenti", href: "/superadmin/utenti" },
        { label: "Allinea email" },
      ]} />

      <div>
        <h1 className="font-tenorite text-3xl text-text">Allinea email utenti</h1>
        <p className="text-text-muted mt-1">
          Sostituisce le email tecniche (es. <code>username@sics.interno</code>) o mancanti con
          <code> username@s-ics.com</code>. Aggiorna sia Supabase Auth sia la tabella utenti.
        </p>
      </div>

      <AllineaEmailClient
        utenti={daAllineare}
        totaleUtenti={all.length}
      />
    </div>
  );
}
