/**
 * L'ALBERO DEI CAMPI.
 *
 * Quello che va dimostrato non è che le caselle si spuntino: è che **non** si
 * spuntino quando produrrebbero una domanda senza senso. Un budget suddiviso
 * per cliente non dà errore — il motore restituisce in silenzio il totale su
 * una riga sola, affiancato a venti barre — ed è esattamente il tipo di
 * confronto che sembra legittimo e non significa niente.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  AlberoCampi,
  SELEZIONE_VUOTA,
  dimensioniAmmesse,
  motivoMisuraNonSelezionabile,
  specDaSelezione,
  type SelezioneCampi,
  type VocabolarioAlbero,
} from "@/components/prototipo-bi/albero-campi";
import type { ChiaveMetrica, Dimensione } from "@/lib/prototipo-bi/tipi";

const COMUNI: Dimensione[] = ["bu", "agente", "cliente", "categoria", "articolo"];

const VOCABOLARIO: VocabolarioAlbero = {
  tipologie: [
    {
      chiave: "ordinato",
      etichetta: "Ordinato",
      descrizione: "Ordini ricevuti.",
      metriche: ["ordinato", "n_ordini"],
    },
    {
      chiave: "budget",
      etichetta: "Budget",
      descrizione: "Obiettivi e pareggio.",
      metriche: ["budget", "bep"],
    },
    {
      chiave: "preventivi",
      etichetta: "Preventivi",
      descrizione: "Offerte commerciali.",
      metriche: ["preventivi_valore"],
    },
  ],
  metriche: [
    { chiave: "ordinato", etichetta: "Importo ordinato", descrizione: "", unita: "euro" },
    { chiave: "n_ordini", etichetta: "Numero di ordini", descrizione: "", unita: "numero" },
    { chiave: "budget", etichetta: "Budget", descrizione: "", unita: "euro" },
    { chiave: "bep", etichetta: "BEP", descrizione: "", unita: "euro" },
    { chiave: "preventivi_valore", etichetta: "Valore preventivi", descrizione: "", unita: "euro" },
  ],
  dimensioni: [
    { chiave: "bu", etichetta: "Business unit" },
    { chiave: "agente", etichetta: "Agente" },
    { chiave: "cliente", etichetta: "Cliente" },
    { chiave: "categoria", etichetta: "Categoria" },
    { chiave: "articolo", etichetta: "Articolo" },
    { chiave: "creatore", etichetta: "Addetto back office" },
    { chiave: "esito", etichetta: "Esito preventivo" },
    { chiave: "fascia_eta", etichetta: "Anzianità preventivo" },
  ],
  dimensioniPerMetrica: {
    ordinato: COMUNI,
    n_ordini: COMUNI,
    budget: COMUNI,
    bep: COMUNI,
    preventivi_valore: [...COMUNI, "creatore", "esito", "fascia_eta"],
  } as Record<ChiaveMetrica, Dimensione[]>,
};

function sel(parziale: Partial<SelezioneCampi>): SelezioneCampi {
  return { ...SELEZIONE_VUOTA, ...parziale };
}

describe("Dalla selezione alla domanda", () => {
  it("senza misure non esiste una domanda", () => {
    expect(specDaSelezione(SELEZIONE_VUOTA)).toBeNull();
  });

  it("una misura sola produce una spec semplice, senza serie", () => {
    const esito = specDaSelezione(sel({ misure: ["ordinato"], suddivisioni: ["agente"] }));
    expect(esito?.serie).toBeNull();
    expect(esito?.spec).toEqual({ metrica: "ordinato", raggruppa: ["agente"] });
  });

  it("la granularità entra nella spec solo se scelta", () => {
    expect(specDaSelezione(sel({ misure: ["ordinato"] }))?.spec.granularita).toBeUndefined();
    expect(
      specDaSelezione(sel({ misure: ["ordinato"], granularita: "mese" }))?.spec.granularita
    ).toBe("mese");
  });

  it("due misure diventano due serie, e la prima comanda", () => {
    const esito = specDaSelezione(sel({ misure: ["ordinato", "n_ordini"] }));
    expect(esito?.serie).toHaveLength(2);
    expect(esito?.serie?.[0].ruolo).toBe("principale");
    expect(esito?.serie?.[1].ruolo).toBe("confronto");
  });

  it("budget e BEP non sono confronti qualsiasi", () => {
    // Il resto del sistema li disegna gia' come bersaglio e come soglia:
    // chiamarli "confronto" li ridurrebbe a una seconda linea indistinguibile.
    const esito = specDaSelezione(sel({ misure: ["ordinato", "budget", "bep"] }));
    expect(esito?.serie?.[1].ruolo).toBe("obiettivo");
    expect(esito?.serie?.[2].ruolo).toBe("soglia");
  });

  it("la misura in più non perde la suddivisione né la granularità", () => {
    // Senza, la serie si riduce a un valore unico e compare sull'asse come una
    // categoria di troppo chiamata «totale», in mezzo ai mesi.
    const esito = specDaSelezione(
      sel({ misure: ["ordinato", "budget"], suddivisioni: ["bu"], granularita: "mese" })
    );
    const budget = esito?.serie?.find((voce) => voce.spec.metrica === "budget");
    expect(budget?.spec.granularita).toBe("mese");
    expect(budget?.spec.raggruppa).toEqual(["bu"]);
  });

  it("tutte le serie condividono suddivisione e periodo", () => {
    const esito = specDaSelezione(
      sel({ misure: ["ordinato", "budget"], suddivisioni: ["bu"], granularita: "mese" })
    );
    for (const serie of esito?.serie ?? []) {
      expect(serie.spec.raggruppa).toEqual(["bu"]);
      expect(serie.spec.granularita).toBe("mese");
    }
  });
});

describe("Quali dimensioni restano ammesse", () => {
  it("con più misure vale l'intersezione, non l'unione", () => {
    // Una dimensione buona per la prima e non per la seconda darebbe una serie
    // piena e una vuota affiancate: sembra un crollo e non lo e'.
    const ammesse = dimensioniAmmesse(["preventivi_valore", "ordinato"], VOCABOLARIO.dimensioniPerMetrica);
    expect(ammesse).toContain("agente");
    expect(ammesse).not.toContain("esito");
  });

  it("senza misure non si offre niente", () => {
    expect(dimensioniAmmesse([], VOCABOLARIO.dimensioniPerMetrica)).toEqual([]);
  });
});

describe("Quando una misura non si può spuntare", () => {
  it("il budget suddiviso per cliente viene rifiutato, con il motivo vero", () => {
    const motivo = motivoMisuraNonSelezionabile(
      "budget",
      sel({ misure: ["ordinato"], suddivisioni: ["cliente"] }),
      VOCABOLARIO.dimensioniPerMetrica
    );
    expect(motivo).toMatch(/business unit e agente/i);
    expect(motivo).toMatch(/cliente/i);
  });

  it("per business unit invece si può", () => {
    expect(
      motivoMisuraNonSelezionabile(
        "budget",
        sel({ misure: ["ordinato"], suddivisioni: ["bu"] }),
        VOCABOLARIO.dimensioniPerMetrica
      )
    ).toBeNull();
  });

  it("una misura già spuntata non si blocca da sola", () => {
    expect(
      motivoMisuraNonSelezionabile(
        "budget",
        sel({ misure: ["budget"], suddivisioni: ["cliente"] }),
        VOCABOLARIO.dimensioniPerMetrica
      )
    ).toBeNull();
  });

  it("una misura che non regge la suddivisione già scelta viene bloccata", () => {
    const motivo = motivoMisuraNonSelezionabile(
      "ordinato",
      sel({ misure: ["preventivi_valore"], suddivisioni: ["esito"] }),
      VOCABOLARIO.dimensioniPerMetrica
    );
    expect(motivo).toMatch(/esito/);
  });
});

describe("L'albero sullo schermo", () => {
  function monta(selezione: SelezioneCampi) {
    const onCambia = vi.fn();
    render(<AlberoCampi vocabolario={VOCABOLARIO} selezione={selezione} onCambia={onCambia} />);
    return onCambia;
  }

  it("spuntare una misura avvisa una volta sola", () => {
    const onCambia = monta(SELEZIONE_VUOTA);
    fireEvent.click(screen.getByRole("checkbox", { name: /Importo ordinato/ }));
    expect(onCambia).toHaveBeenCalledTimes(1);
    expect(onCambia).toHaveBeenCalledWith(expect.objectContaining({ misure: ["ordinato"] }));
  });

  it("senza misure le suddivisioni sono spente e dicono perché", () => {
    monta(SELEZIONE_VUOTA);
    // «Clienti e agenti» e' il primo gruppo ed e' gia' aperto: cliccarlo lo
    // chiuderebbe.
    const cliente = screen.getByRole("checkbox", { name: /Cliente/ });
    expect(cliente).toBeDisabled();
    expect(screen.getAllByText(/Scegli prima una misura/).length).toBeGreaterThan(0);
  });

  it("alla terza suddivisione il limite è scritto, non subìto", () => {
    monta(sel({ misure: ["ordinato"], suddivisioni: ["bu", "agente"] }));
    fireEvent.click(screen.getByRole("button", { name: /Prodotti/ }));
    const categoria = screen.getByRole("checkbox", { name: /Categoria/ });
    expect(categoria).toBeDisabled();
    expect(screen.getAllByText(/Al massimo due/).length).toBeGreaterThan(0);
  });

  it("il Calendario è a scelta singola", () => {
    // Il Calendario si apre da solo perche' una granularita' e' gia' scelta.
    const onCambia = monta(sel({ misure: ["ordinato"], granularita: "giorno" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Mese" }));
    expect(onCambia).toHaveBeenCalledWith(expect.objectContaining({ granularita: "mese" }));
  });

  it("le frecce riordinano senza bisogno di trascinare", () => {
    // Chi ha un trackpad, la mano poco ferma o naviga da tastiera non deve
    // restare fuori: su questo pubblico non e' un caso limite.
    const onCambia = monta(sel({ misure: ["ordinato"], suddivisioni: ["bu", "agente"] }));
    fireEvent.click(screen.getByRole("button", { name: /Sposta Agente più in alto/ }));
    expect(onCambia).toHaveBeenCalledWith(
      expect.objectContaining({ suddivisioni: ["agente", "bu"] })
    );
  });

  it("togliendo una misura cadono le suddivisioni che solo lei ammetteva", () => {
    const onCambia = monta(sel({ misure: ["preventivi_valore", "ordinato"], suddivisioni: ["bu"] }));
    // «Preventivi» e' sia una tipologia sia un gruppo di dimensioni: la ricerca
    // va ristretta alla colonna giusta. Il gruppo e' gia' aperto perche'
    // contiene una misura spuntata.
    const misure = within(screen.getByRole("region", { name: /Che cosa vuoi misurare/ }));
    fireEvent.click(misure.getByRole("checkbox", { name: /Valore preventivi/ }));
    expect(onCambia).toHaveBeenCalledWith(
      expect.objectContaining({ misure: ["ordinato"], suddivisioni: ["bu"] })
    );
  });
});
