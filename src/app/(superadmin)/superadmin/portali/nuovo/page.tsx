import { PortaleForm } from "@/components/superadmin/portale-form";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function NuovoPortalePage() {
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
        <h1 className="font-tenorite text-3xl text-text">Nuovo portale</h1>
        <p className="text-text-muted mt-1">Crea un nuovo portale e configurane le impostazioni</p>
      </div>

      <div className="bg-bg rounded-xl border border-border p-6">
        <PortaleForm />
      </div>
    </div>
  );
}
