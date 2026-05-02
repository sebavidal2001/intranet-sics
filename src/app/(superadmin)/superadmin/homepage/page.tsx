import { createClient } from "@/lib/supabase/server";
import { HomepageBlocksManager } from "@/components/superadmin/homepage-blocks-manager";

interface HomepageBlock {
  id: string;
  tipo: "news" | "link";
  titolo: string;
  testo: string | null;
  url: string | null;
  icona: string | null;
  ordine: number;
  is_attivo: boolean;
}

async function getBlocks(): Promise<HomepageBlock[]> {
  const supabase = await createClient();
  // Superadmin deve vedere tutti i blocchi, anche quelli non attivi
  // Usiamo la policy superadmin che bypassa il filtro is_attivo
  const { data, error } = await supabase
    .from("homepage_blocks")
    .select("id, tipo, titolo, testo, url, icona, ordine, is_attivo")
    .order("tipo", { ascending: true })
    .order("ordine", { ascending: true });

  if (error) throw error;
  return (data ?? []) as HomepageBlock[];
}

export default async function HomepagePage() {
  const blocks = await getBlocks();

  const news = blocks.filter((b) => b.tipo === "news");
  const links = blocks.filter((b) => b.tipo === "link");

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-tenorite text-3xl text-text">Contenuti homepage</h1>
        <p className="text-text-muted mt-1">
          Gestisci le news e i link rapidi visibili nella homepage intranet
        </p>
      </div>

      <HomepageBlocksManager newsBlocks={news} linkBlocks={links} />
    </div>
  );
}
