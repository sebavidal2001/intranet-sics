/**
 * Il valore scelto con un clic resta evidenziato e il resto si attenua: la
 * selezione arriva ai grafici da un contesto, senza una proprieta' per ognuno.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SelezioneLocale } from "@/components/prototipo-bi/impostazioni";
import { TabellaAnalitica } from "@/components/prototipo-bi/tabella-analitica";

afterEach(cleanup);

const colonne = [{ chiave: "valore", etichetta: "Valore", tipo: "numero" as const, unita: "numero" as const }];
const righe = [
  { chiave: "ACME", celle: { valore: 30 } },
  { chiave: "BETA", celle: { valore: 20 } },
  { chiave: "GAMMA", celle: { valore: 10 } },
];
const riga = (nome: string) => screen.getByText(nome).closest("tr") as HTMLElement;

describe("tabella con una voce selezionata", () => {
  it("la riga scelta e' evidenziata, le altre attenuate", () => {
    render(
      <SelezioneLocale valore="BETA">
        <TabellaAnalitica colonne={colonne} righe={righe} ricercabile={false} />
      </SelezioneLocale>
    );
    expect(riga("BETA").className).toContain("bg-primary/10");
    expect(riga("BETA").className).not.toContain("opacity-45");
    expect(riga("ACME").className).toContain("opacity-45");
    expect(riga("GAMMA").className).toContain("opacity-45");
  });

  it("senza selezione nessuna riga cambia", () => {
    render(<TabellaAnalitica colonne={colonne} righe={righe} ricercabile={false} />);
    for (const nome of ["ACME", "BETA", "GAMMA"]) {
      expect(riga(nome).className).not.toContain("opacity-45");
      expect(riga(nome).className).not.toContain("bg-primary/10");
    }
  });
});
