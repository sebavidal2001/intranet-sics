import { redirect } from "next/navigation";
import { getSessionUser, getSessionProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getPortaleAccesso } from "@/lib/auth/portale";
import { PreventivatoreSidebar } from "@/components/portali/preventivatore/sidebar-nav";
import { PORTALE_SLUGS } from "@/lib/config/portali";

export default async function PortalePreventiviatoreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/auth/login");

  const supabase = await createClient();

  const [livello, profile] = await Promise.all([
    getPortaleAccesso(supabase, user.id, PORTALE_SLUGS.PREVENTIVATORE),
    getSessionProfile(),
  ]);

  if (livello === null) redirect("/");

  return (
    <div className="flex flex-row min-h-[calc(100vh-4rem)]" style={{ background: "#f6f8fb" }}>
      <PreventivatoreSidebar livello={livello} profile={profile} />
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
