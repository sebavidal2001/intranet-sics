import { createClient } from "@/lib/supabase/server";
import { PortaleForm } from "@/components/superadmin/portale-form";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

interface PortaleData {
  id: string;
  nome: string;
  slug: string;
  descrizione: string | null;
  icona: string | null;
  colore: string | null;
  ordine: number;
  is_attivo: boolean;
}

async function getPortale(id: string): Promise<PortaleData | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("portali")
    .select("id, nome, slug, descrizione, icona, colore, ordine, is_attivo")
    .eq("id", id)
    .single();

  return data as PortaleData | null;
}

export default async function ModificaPortalePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const portale = await getPortale(id);

  if (!portale) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <Link
          href="/superadmin/portali"
          className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Torna ai portali
        </Link>
        <div className="bg-bg rounded-xl border border-border p-8 text-center">
          <p className="font-tenorite text-lg text-text">Portale non trovato</p>
          <p className="text-text-muted text-sm mt-1">
            Il portale richiesto non esiste o è stato eliminato.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <Link
          href="/superadmin/portali"
          className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text transition-colors mb-3"
        >
          <ArrowLeft className="w-4 h-4" />
          Torna ai portali
        </Link>
        <h1 className="font-tenorite text-3xl text-text">Modifica portale</h1>
        <p className="text-text-muted mt-1">{portale.nome}</p>
      </div>

      <div className="bg-bg rounded-xl border border-border p-6">
        <PortaleForm portale={portale} />
      </div>
    </div>
  );
}
