import { createAdminClient } from "@/lib/supabase/admin";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import RuoliRepartiManager from "./ruoli-reparti-manager";

interface RuoloConfig {
  id: string;
  nome: string;
  slug: string;
  colore: string;
  ordine: number;
  is_system: boolean;
}

interface Reparto {
  id: string;
  nome: string;
  descrizione: string | null;
  ordine: number;
  attivo: boolean;
}

async function getData(): Promise<{ ruoli: RuoloConfig[]; reparti: Reparto[] }> {
  const supabase = createAdminClient();

  const [ruoliRes, repartiRes] = await Promise.all([
    supabase
      .from("ruoli_config")
      .select("id, nome, slug, colore, ordine, is_system")
      .order("ordine", { ascending: true }),
    supabase
      .from("reparti")
      .select("id, nome, descrizione, ordine, attivo")
      .order("ordine", { ascending: true }),
  ]);

  return {
    ruoli: (ruoliRes.data ?? []) as RuoloConfig[],
    reparti: (repartiRes.data ?? []) as Reparto[],
  };
}

export default async function RuoliConfigPage() {
  const { ruoli, reparti } = await getData();

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <Breadcrumbs items={[
        { label: "Superadmin", href: "/superadmin" },
        { label: "Ruoli & Reparti" },
      ]} />
      {/* Header */}
      <div>
        <h1 className="font-tenorite text-3xl text-text">Ruoli & Reparti</h1>
        <p className="text-text-muted mt-1">
          Aggiungi, modifica o rimuovi ruoli e reparti aziendali
        </p>
      </div>

      <RuoliRepartiManager ruoli={ruoli} reparti={reparti} />
    </div>
  );
}
