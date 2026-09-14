/**
 * LE DESTINAZIONI DEL BI.
 *
 * Cruscotto, Dashboard, Analisi ed Esplora erano quattro voci per un solo
 * compito, e la conseguenza pratica era che nessuno capiva quale aprire. Qui
 * si fissa che restano cinque destinazioni e che le route assorbite non sono
 * state cancellate: chi ha un collegamento salvato deve ancora arrivarci, e la
 * voce Dashboard deve restare accesa quando ci arriva.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NavigazionePrototipo } from "@/components/prototipo-bi/navigazione";

const percorsoFinto = vi.hoisted(() => ({ valore: "/bi" }));

vi.mock("next/navigation", () => ({
  usePathname: () => percorsoFinto.valore,
}));

function montaSu(percorso: string) {
  percorsoFinto.valore = percorso;
  return render(<NavigazionePrototipo />);
}

describe("La barra del BI", () => {
  it("offre cinque destinazioni, non una per ogni schermata", () => {
    montaSu("/bi");
    const voci = screen.getAllByRole("link").map((l) => l.textContent?.trim());
    expect(voci).toEqual([
      "Briefing",
      "Dashboard",
      "Articoli & Acquisti",
      "Analista",
      "Budget & BEP",
    ]);
  });

  it("non propone più Cruscotto e Analisi come voci separate", () => {
    montaSu("/bi");
    expect(screen.queryByRole("link", { name: "Cruscotto" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Analisi" })).toBeNull();
  });

  it.each([
    "/bi/dashboard",
    "/bi/dashboard/abc-123",
    "/bi/cruscotto",
    "/bi/analisi",
    "/bi/esplora",
  ])("su %s resta accesa la voce Dashboard", (percorso) => {
    montaSu(percorso);
    const dashboard = screen.getByRole("link", { name: /Dashboard/ });
    expect(dashboard.className).toContain("border-primary");
  });

  it("il Briefing non si accende dalle sottopagine degli altri rami", () => {
    // "/bi" è prefisso di tutto: senza il controllo esatto resterebbe sempre
    // acceso e la barra smetterebbe di dire dove ci si trova.
    montaSu("/bi/analista");
    const briefing = screen.getByRole("link", { name: "Briefing" });
    expect(briefing.className).not.toContain("border-primary");
    expect(screen.getByRole("link", { name: "Analista" }).className).toContain("border-primary");
  });
});
