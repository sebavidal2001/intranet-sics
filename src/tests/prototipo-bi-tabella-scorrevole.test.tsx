import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TabellaAnalitica, type ColonnaAnalitica, type RigaAnalitica } from "@/components/prototipo-bi/tabella-analitica";

describe("tabella che scorre", () => {
  afterEach(cleanup);
  const colonne = [
    { chiave: "nome", etichetta: "Nome", tipo: "testo" },
    { chiave: "q", etichetta: "Quantità", tipo: "numero" },
  ] as unknown as ColonnaAnalitica[];
  const righe: RigaAnalitica[] = Array.from({ length: 500 }, (_, i) => ({ chiave: `r${i}`, celle: { nome: `Voce ${i}`, q: i } }));

  it("niente «mostra altre righe»: intestazione ferma e righe caricate scorrendo", () => {
    const { container } = render(<TabellaAnalitica colonne={colonne} righe={righe} senzaColonnaVoce />);
    expect(screen.queryByText(/Mostra/)).not.toBeInTheDocument();
    expect(screen.getByText("500 righe")).toBeInTheDocument();
    expect(container.querySelector("thead")?.className).toContain("sticky");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(200);

    const scorrevole = container.querySelector("div.overflow-auto") as HTMLElement;
    Object.defineProperty(scorrevole, "scrollHeight", { value: 5000, configurable: true });
    Object.defineProperty(scorrevole, "clientHeight", { value: 400, configurable: true });
    scorrevole.scrollTop = 4500;
    fireEvent.scroll(scorrevole);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(400);
  });
});
