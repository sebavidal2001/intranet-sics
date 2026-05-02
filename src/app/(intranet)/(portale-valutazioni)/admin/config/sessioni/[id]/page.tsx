import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SessioneDetail from "./sessione-detail";

export default async function SessioneDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const { data: userProfile } = await supabase
    .from("utenti")
    .select("ruolo")
    .eq("id", user.id)
    .single();

  if (!userProfile || userProfile.ruolo !== "admin") {
    redirect("/");
  }

  const { data: sessione } = await supabase
    .from("sessioni_valutazione")
    .select("*, scala:scale_valutazione(nome)")
    .eq("id", id)
    .single() as unknown as { data: { id: string; anno: number; is_aperta: boolean; scala: { nome: string } | null } | null };

  if (!sessione) redirect("/admin/config");

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <SessioneDetail sessione={sessione} />
    </div>
  );
}
