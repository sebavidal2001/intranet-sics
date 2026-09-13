import { BannerPrototipo } from "@/components/prototipo-bi/banner";
import { NavigazionePrototipo } from "@/components/prototipo-bi/navigazione";
import { ImpostazioniProvider } from "@/components/prototipo-bi/impostazioni";
import { verificaAccessoSicuro } from "@/lib/prototipo-bi/accesso";
import { ShieldAlert } from "lucide-react";

export default async function LayoutPrototipoBi({
  children,
}: {
  children: React.ReactNode;
}) {
  // Chi entra lo decide il portale `bi`, come per ogni altro portale: nessuna
  // barriera d'ambiente, nessuna variabile da ricordarsi di togliere.
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
