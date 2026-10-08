"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard } from "lucide-react";

/**
 * Per chi riceve solo dashboard assegnate, l'unica sezione del portale è
 * "Dashboard". Le altre pagine non si nascondono soltanto dalla barra: se
 * qualcuno scrive l'indirizzo a mano trova questo avviso, non la pagina.
 *
 * Non è la barriera di sicurezza dei dati (quella è il perimetro, applicato
 * allo snapshot): è coerenza di prodotto, perché Analista, Budget e Cruscotto
 * sono strumenti della direzione.
 */
export function GuardiaSoloDashboard({
  attiva,
  children,
}: {
  attiva: boolean;
  children: React.ReactNode;
}) {
  const percorso = usePathname();
  if (!attiva || percorso === "/bi/dashboard" || percorso.startsWith("/bi/dashboard/")) {
    return <>{children}</>;
  }
  return (
    <div className="max-w-xl mx-auto py-24 px-4 text-center">
      <LayoutDashboard className="w-10 h-10 text-primary mx-auto mb-4" aria-hidden />
      <h1 className="font-tenorite text-xl mb-2">Questa sezione non è per il tuo profilo</h1>
      <p className="text-text-muted text-sm mb-5">
        Hai accesso alle dashboard che la direzione ti ha assegnato.
      </p>
      <Link
        href="/bi/dashboard"
        className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark"
      >
        Vai alle tue dashboard
      </Link>
    </div>
  );
}
