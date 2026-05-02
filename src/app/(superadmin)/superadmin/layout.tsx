import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SuperadminSidebar } from "@/components/superadmin/superadmin-sidebar";
import { getSessionUser } from "@/lib/auth/session";

export default async function SuperadminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // getSessionUser usa React.cache — deduplica la chiamata auth.getUser() nel request
  const user = await getSessionUser();
  if (!user) redirect("/auth/login");

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("utenti")
    .select("ruolo")
    .eq("id", user.id)
    .single();

  if (profile?.ruolo !== "superadmin") {
    redirect("/");
  }

  return (
    <div className="min-h-screen bg-bg-page flex">
      <SuperadminSidebar />
      <main className="flex-1 p-8 overflow-auto">
        {children}
      </main>
    </div>
  );
}
