/** ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE */

import { BannerPrototipo } from "@/components/prototipo-bi/banner";
import { NavigazionePrototipo } from "@/components/prototipo-bi/navigazione";
import { ImpostazioniProvider } from "@/components/prototipo-bi/impostazioni";
import { prototipoConsentito } from "@/lib/prototipo-bi/guardia";
import { verificaAccessoSicuro } from "@/lib/prototipo-bi/accesso";
import { ShieldAlert } from "lucide-react";

export default async function LayoutPrototipoBi({
  children,
}: {
  children: React.ReactNode;
}) {
  // Barriera 2: la guardia di runtime. In produzione il prototipo non esiste.
  if (!prototipoConsentito()) {
    return (
      <div className="max-w-xl mx-auto py-24 px-4 text-center">
        <ShieldAlert className="w-10 h-10 text-danger mx-auto mb-4" aria-hidden />
        <h1 className="font-tenorite text-xl mb-2">Modulo non disponibile</h1>
        <p className="text-text-muted text-sm">
          Questo modulo è un prototipo in attesa di approvazione e non è attivo
          in produzione.
        </p>
      </div>
    );
  }

  const esito = await verificaAccessoSicuro();

  return (
    <ImpostazioniProvider>
      <div className="min-h-screen flex flex-col">
        <BannerPrototipo />
        <NavigazionePrototipo />
        {esito.ok ? (
          children
        ) : (
          <div className="max-w-xl mx-auto py-24 px-4 text-center">
            <ShieldAlert className="w-10 h-10 text-warning mx-auto mb-4" aria-hidden />
            <h1 className="font-tenorite text-xl mb-2">Accesso non consentito</h1>
            <p className="text-text-muted text-sm">{esito.motivo}</p>
          </div>
        )}
      </div>
    </ImpostazioniProvider>
  );
}
