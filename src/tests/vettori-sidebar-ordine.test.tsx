import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { VettoriSidebar } from "@/components/portali/vettori/sidebar-nav";

vi.mock("next/navigation", () => ({ usePathname: () => "/vettori/bolle" }));

describe("menu del portale vettori", () => {
  it("segue la giornata dell'operatore, come chiesto dall'amministrazione", () => {
    render(<VettoriSidebar livello="admin" profile={null} ruoli={[]} puoGestire puoRegistrareArrivi />);
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Simulazione", "Bolle", "Spedizioni", "Fatture", "Anomalie", "Analisi", "Listini",
    ]);
  });

  it("il magazzino vede solo simulazione, bolle e analisi", () => {
    render(<VettoriSidebar livello="viewer" profile={null} ruoli={[]} puoGestire={false} puoRegistrareArrivi />);
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["Simulazione", "Bolle", "Analisi"]);
  });
});
