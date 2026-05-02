import { redirect, notFound } from "next/navigation";
import { getSessionUser, getSessionIsAdmin } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import ModificaScalaForm from "./modifica-scala-form";

export default async function ModificaScalaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [user, isAdmin] = await Promise.all([
    getSessionUser(),
    getSessionIsAdmin(),
  ]);
  if (!user) redirect("/auth/login");
  if (!isAdmin) redirect("/");

  const { id } = await params;
  const supabase = createAdminClient();

  const { data: scala } = await supabase
    .from("scale_valutazione")
    .select("*")
    .eq("id", id)
    .single();

  if (!scala) notFound();

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Breadcrumbs items={[
        { label: "Config", href: "/admin/config" },
        { label: "Scale", href: "/admin/config" },
        { label: scala.nome },
      ]} />
      <div className="mb-6">
        <h1 className="font-tenorite text-2xl text-text">Modifica Scala</h1>
        <p className="text-text-muted text-sm mt-1">
          Aggiorna nome, range e etichette della scala di valutazione.
        </p>
      </div>
      <div className="bg-bg rounded-xl border border-border p-6">
        <ModificaScalaForm scala={scala} />
      </div>
    </div>
  );
}
