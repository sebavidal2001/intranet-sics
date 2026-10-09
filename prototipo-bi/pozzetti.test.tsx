/**
 * I pozzetti come li vive chi li usa: trascinare dall'albero, scegliere dal
 * menu, togliere, riordinare. Ogni gesto rifiutato deve dire perche', e il
 * trascinamento non e' mai l'unica strada.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AlberoCampi, SELEZIONE_VUOTA, type SelezioneCampi, type VocabolarioAlbero } from "@/components/prototipo-bi/albero-campi";
import { Pozzetti } from "@/components/prototipo-bi/pozzetti";
import { TIPO_MIME_CAMPO, impostaTrascinamento, type VoceCampo } from "@/components/prototipo-bi/pozzetti-regole";
import type { Dimensione, Filtro } from "@/lib/prototipo-bi/tipi";

const COMUNI: Dimensione[] = ["bu", "agente", "cliente"];

const VOCABOLARIO: VocabolarioAlbero = {
  tipologie: [
    { chiave: "ordinato", etichetta: "Ordinato", descrizione: "Ordini ricevuti.", metriche: ["ordinato", "n_ordini"] },
    { chiave: "fatturato", etichetta: "Fatturato", descrizione: "Fatture emesse.", metriche: ["fatturato"] },
    { chiave: "budget", etichetta: "Budget", descrizione: "Obiettivi.", metriche: ["budget"] },
    { chiave: "preventivi", etichetta: "Preventivi", descrizione: "Offerte.", metriche: ["preventivi_valore"] },
  ],
  metriche: [
    { chiave: "ordinato", etichetta: "Valore ordinato", descrizione: "", unita: "euro" },
    { chiave: "n_ordini", etichetta: "Numero ordini", descrizione: "", unita: "numero" },
    { chiave: "fatturato", etichetta: "Valore fatturato", descrizione: "", unita: "euro" },
    { chiave: "budget", etichetta: "Budget", descrizione: "", unita: "euro" },
    { chiave: "preventivi_valore", etichetta: "Valore preventivi", descrizione: "", unita: "euro" },
  ],
  dimensioni: [
    { chiave: "bu", etichetta: "Business unit" },
    { chiave: "agente", etichetta: "Agente" },
    { chiave: "cliente", etichetta: "Cliente" },
    { chiave: "esito", etichetta: "Esito" },
  ],
  dimensioniPerMetrica: {
    ordinato: COMUNI,
    n_ordini: COMUNI,
    fatturato: COMUNI,
    budget: COMUNI,
    preventivi_valore: [...COMUNI, "esito"],
  },
};

const misura = (chiave: string): VoceCampo => ({ tipo: "misura", chiave: chiave as never });
const dim = (chiave: Dimensione): VoceCampo => ({ tipo: "dimensione", chiave });
const tempo = (chiave: "giorno" | "settimana" | "mese" | "anno"): VoceCampo => ({ tipo: "calendario", chiave });

/** Un trasferimento finto che si comporta come quello vero: cio' che si imposta si rilegge. */
function trasferimento() {
  const dati: Record<string, string> = {};
  return {
    dropEffect: "",
    effectAllowed: "",
    setData: (tipo: string, valore: string) => {
      dati[tipo] = valore;
    },
    getData: (tipo: string) => dati[tipo] ?? "",
  };
}

function rilascia(pozzetto: string, voce: VoceCampo) {
  const dt = trasferimento();
  dt.setData(TIPO_MIME_CAMPO, JSON.stringify(voce));
  fireEvent.drop(screen.getByRole("region", { name: pozzetto }), { dataTransfer: dt });
}

function Banco({
  iniziale = { misure: [], suddivisioni: [] },
  filtriIniziali = [],
  conAlbero = false,
}: {
  iniziale?: SelezioneCampi;
  filtriIniziali?: Filtro[];
  conAlbero?: boolean;
}) {
  const [selezione, setSelezione] = useState<SelezioneCampi>(iniziale);
  const [filtri, setFiltri] = useState<Filtro[]>(filtriIniziali);
  return (
    <>
      {conAlbero && <AlberoCampi vocabolario={VOCABOLARIO} selezione={selezione} onCambia={setSelezione} />}
      <Pozzetti
        vocabolario={VOCABOLARIO}
        selezione={selezione}
        filtri={filtri}
        onCambia={setSelezione}
        onAggiungiFiltro={(campo) => setFiltri((f) => [...f, { campo, op: "in", valore: [] }])}
        onTogliFiltro={(i) => setFiltri((f) => f.filter((_, k) => k !== i))}
      />
      <div data-testid="selezione">{JSON.stringify(selezione)}</div>
    </>
  );
}

const selezioneCorrente = () => JSON.parse(screen.getByTestId("selezione").textContent ?? "{}") as SelezioneCampi;
const pozzetto = (nome: string) => screen.getByRole("region", { name: nome });
const messaggio = () => screen.getByRole("status");

afterEach(() => {
  act(() => impostaTrascinamento(null));
});

describe("Pozzetti: cosa si vede", () => {
  it("quattro pozzetti vuoti con il loro invito, e il menu sempre a portata", () => {
    render(<Banco />);
    for (const [nome, invito] of [
      ["Asse", /una dimensione o il tempo/],
      ["Legenda", /una seconda dimensione/],
      ["Valori", /una misura/],
      ["Filtri", /una dimensione da filtrare/],
    ] as const) {
      expect(within(pozzetto(nome)).getByText(invito)).toBeInTheDocument();
      expect(within(pozzetto(nome)).getByLabelText(`Aggiungi a ${nome}`)).toBeInTheDocument();
    }
  });

  it("rispecchia una selezione che c'e' gia': misure con il loro ruolo, asse e legenda", () => {
    render(<Banco iniziale={{ misure: ["ordinato", "fatturato", "budget"], suddivisioni: ["bu", "agente"] }} />);
    const valori = within(pozzetto("Valori"));
    expect(valori.getByText("Valore ordinato")).toBeInTheDocument();
    expect(valori.getByText(/principale/)).toBeInTheDocument();
    expect(valori.getByText(/confronto/)).toBeInTheDocument();
    expect(valori.getByText(/obiettivo/)).toBeInTheDocument();
    expect(within(pozzetto("Asse")).getByText("Business unit")).toBeInTheDocument();
    expect(within(pozzetto("Legenda")).getByText("Agente")).toBeInTheDocument();
  });

  it("con il tempo sull'asse lo dice, e la dimensione sta in legenda", () => {
    render(<Banco iniziale={{ misure: ["ordinato"], suddivisioni: ["bu"], granularita: "mese" }} />);
    expect(within(pozzetto("Asse")).getByText("Mese")).toBeInTheDocument();
    expect(within(pozzetto("Asse")).getByText(/· tempo/)).toBeInTheDocument();
    expect(within(pozzetto("Legenda")).getByText("Business unit")).toBeInTheDocument();
  });

  it("i filtri si riassumono: quanti valori, o «da scegliere»", () => {
    render(
      <Banco
        iniziale={{ misure: ["ordinato"], suddivisioni: [] }}
        filtriIniziali={[
          { campo: "cliente", op: "in", valore: [] },
          { campo: "agente", op: "in", valore: ["Anna", "Bruno", "Carla"] },
          { campo: "bu", op: "eq", valore: "COMPONENTI" },
        ]}
      />
    );
    const filtri = within(pozzetto("Filtri"));
    expect(filtri.getByText("Cliente: da scegliere")).toBeInTheDocument();
    expect(filtri.getByText("Agente: 3 valori")).toBeInTheDocument();
    expect(filtri.getByText("Business unit: COMPONENTI")).toBeInTheDocument();
    // E ricorda dove si scelgono i valori.
    expect(screen.getByText(/si scelgono nel riquadro «Solo dove»/)).toBeInTheDocument();
  });
});

describe("Pozzetti: trascinare", () => {
  it("una misura nei valori; una dimensione nei valori e' rifiutata col motivo e non cambia niente", () => {
    render(<Banco />);
    rilascia("Valori", misura("ordinato"));
    expect(selezioneCorrente().misure).toEqual(["ordinato"]);
    expect(within(pozzetto("Valori")).getByText("Valore ordinato")).toBeInTheDocument();

    rilascia("Valori", dim("cliente"));
    expect(messaggio()).toHaveTextContent("Nei valori vanno le misure");
    expect(selezioneCorrente().misure).toEqual(["ordinato"]);
  });

  it("asse e legenda: un campo sostituisce quello che c'era, e il gesto lo dice", () => {
    render(<Banco iniziale={{ misure: ["ordinato"], suddivisioni: [] }} />);
    rilascia("Asse", dim("bu"));
    rilascia("Legenda", dim("agente"));
    expect(selezioneCorrente().suddivisioni).toEqual(["bu", "agente"]);

    rilascia("Asse", dim("cliente"));
    expect(selezioneCorrente().suddivisioni).toEqual(["cliente", "agente"]);
    expect(messaggio()).toHaveTextContent("«Cliente» ha preso il posto di «Business unit» sull'asse.");
    expect(within(pozzetto("Asse")).getByText("Cliente")).toBeInTheDocument();
  });

  it("il tempo sull'asse; il tempo nella legenda e' rifiutato", () => {
    render(<Banco iniziale={{ misure: ["ordinato"], suddivisioni: ["bu"] }} />);
    rilascia("Asse", tempo("mese"));
    expect(selezioneCorrente().granularita).toBe("mese");
    expect(messaggio()).toHaveTextContent("Il tempo ha preso il posto di «Business unit»");

    rilascia("Legenda", tempo("anno"));
    expect(messaggio()).toHaveTextContent("Il tempo va sull'asse");
    expect(selezioneCorrente().granularita).toBe("mese");
  });

  it("senza misura niente si suddivide: lo dice", () => {
    render(<Banco />);
    rilascia("Asse", dim("cliente"));
    expect(messaggio()).toHaveTextContent("Scegli prima una misura.");
    expect(selezioneCorrente().suddivisioni).toEqual([]);
  });

  it("una dimensione che la misura non ha e' rifiutata col suo motivo", () => {
    render(<Banco iniziale={{ misure: ["ordinato"], suddivisioni: [] }} />);
    rilascia("Asse", dim("esito"));
    expect(messaggio()).toHaveTextContent("Solo per i preventivi");
  });

  it("il budget accanto a una suddivisione per cliente sparisce, e il gesto lo dice", () => {
    render(<Banco iniziale={{ misure: ["ordinato", "budget"], suddivisioni: [] }} />);
    rilascia("Asse", dim("cliente"));
    expect(selezioneCorrente().misure).toEqual(["ordinato"]);
    expect(messaggio()).toHaveTextContent("Ho tolto «Budget»");
    expect(within(pozzetto("Valori")).queryByText("Budget")).not.toBeInTheDocument();
  });

  it("filtri: una dimensione aggiunge un filtro da completare; una seconda volta no, e dice dov'e'", () => {
    render(<Banco iniziale={{ misure: ["ordinato"], suddivisioni: [] }} />);
    rilascia("Filtri", dim("cliente"));
    expect(within(pozzetto("Filtri")).getByText("Cliente: da scegliere")).toBeInTheDocument();
    expect(messaggio()).toHaveTextContent("Filtro su Cliente aggiunto: scegli i valori nel riquadro «Solo dove»");
    // La selezione (misure e suddivisioni) non e' cambiata.
    expect(selezioneCorrente()).toEqual({ misure: ["ordinato"], suddivisioni: [] });

    rilascia("Filtri", dim("cliente"));
    expect(messaggio()).toHaveTextContent("C'è già un filtro su Cliente");
    expect(within(pozzetto("Filtri")).getAllByText(/Cliente:/)).toHaveLength(1);
  });

  it("filtri: una misura o il tempo sono rifiutati", () => {
    render(<Banco iniziale={{ misure: ["ordinato"], suddivisioni: [] }} />);
    rilascia("Filtri", misura("fatturato"));
    expect(messaggio()).toHaveTextContent("non le misure");
    rilascia("Filtri", tempo("mese"));
    expect(messaggio()).toHaveTextContent("riquadro «Quando»");
  });

  it("un trasferimento senza contenuto riconoscibile non fa niente", () => {
    render(<Banco iniziale={{ misure: ["ordinato"], suddivisioni: [] }} />);
    fireEvent.drop(pozzetto("Asse"), { dataTransfer: trasferimento() });
    expect(selezioneCorrente().suddivisioni).toEqual([]);
  });

  it("durante il trascinamento i pozzetti che accetterebbero la voce si evidenziano, gli altri si attenuano", () => {
    render(<Banco iniziale={{ misure: ["ordinato"], suddivisioni: [] }} />);
    act(() => impostaTrascinamento(dim("cliente")));
    expect(pozzetto("Asse").className).toContain("border-primary");
    expect(pozzetto("Filtri").className).toContain("border-primary");
    // Valori non accetta dimensioni, e la Legenda non ha ancora un asse.
    expect(pozzetto("Valori").className).toContain("border-dashed");
    expect(pozzetto("Legenda").className).toContain("border-dashed");
    act(() => impostaTrascinamento(null));
    expect(pozzetto("Asse").className).not.toContain("border-primary");
  });

  it("il rilascio e' sempre accettato dal browser (il rifiuto si spiega, non si nega col cursore)", () => {
    render(<Banco />);
    const dt = trasferimento();
    // fireEvent restituisce false se l'evento e' stato annullato (preventDefault).
    const accettato = fireEvent.dragOver(pozzetto("Valori"), { dataTransfer: dt });
    expect(accettato).toBe(false);
    expect(dt.dropEffect).toBe("move");
  });
});

describe("Pozzetti: dall'albero ai pozzetti", () => {
  it("una casella aperta dell'albero e' trascinabile, e il rilascio nell'asse dà la stessa selezione della spunta", () => {
    render(<Banco iniziale={{ misure: ["ordinato"], suddivisioni: [] }} conAlbero />);
    for (const gruppo of screen.getAllByRole("button", { expanded: false })) fireEvent.click(gruppo);
    const etichetta = screen.getByRole("checkbox", { name: "Cliente" }).closest("label") as HTMLElement;
    expect(etichetta.getAttribute("draggable")).toBe("true");

    const dt = trasferimento();
    fireEvent.dragStart(etichetta, { dataTransfer: dt });
    expect(JSON.parse(dt.getData(TIPO_MIME_CAMPO))).toEqual(dim("cliente"));
    fireEvent.drop(pozzetto("Asse"), { dataTransfer: dt });
    expect(selezioneCorrente().suddivisioni).toEqual(["cliente"]);
    // E l'albero lo mostra spuntato: e' la stessa selezione.
    expect(screen.getByRole("checkbox", { name: "Cliente" })).toBeChecked();
    fireEvent.dragEnd(etichetta);
  });

  it("una casella bloccata non si trascina: il motivo e' gia' scritto accanto", () => {
    render(<Banco iniziale={{ misure: ["ordinato"], suddivisioni: [] }} conAlbero />);
    for (const gruppo of screen.getAllByRole("button", { expanded: false })) fireEvent.click(gruppo);
    const esito = screen.getByRole("checkbox", { name: /^Esito/ }).closest("label") as HTMLElement;
    expect(esito.getAttribute("draggable")).toBe("false");
  });

  it("tutte le voci dell'albero (misure, dimensioni, tempo) si trascinano con il proprio contenuto", () => {
    render(<Banco iniziale={{ misure: ["ordinato"], suddivisioni: [] }} conAlbero />);
    for (const gruppo of screen.getAllByRole("button", { expanded: false })) fireEvent.click(gruppo);
    const prova = (nome: string | RegExp, atteso: VoceCampo) => {
      const label = screen.getByRole("checkbox", { name: nome }).closest("label") as HTMLElement;
      const dt = trasferimento();
      fireEvent.dragStart(label, { dataTransfer: dt });
      expect(JSON.parse(dt.getData(TIPO_MIME_CAMPO))).toEqual(atteso);
      fireEvent.dragEnd(label);
    };
    prova("Valore fatturato", misura("fatturato"));
    prova("Business unit", dim("bu"));
    prova("Mese", tempo("mese"));
  });
});

describe("Pozzetti: togliere e riordinare", () => {
  it("togliere l'asse fa scalare la legenda e lo dice", () => {
    render(<Banco iniziale={{ misure: ["ordinato"], suddivisioni: ["bu", "agente"] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Togli Business unit dall'asse" }));
    expect(selezioneCorrente().suddivisioni).toEqual(["agente"]);
    expect(messaggio()).toHaveTextContent("«Agente» è passata dalla legenda all'asse.");
  });

  it("togliere la legenda e il tempo", () => {
    render(<Banco iniziale={{ misure: ["ordinato"], suddivisioni: ["bu"], granularita: "mese" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Togli Business unit dalla legenda" }));
    expect(selezioneCorrente().suddivisioni).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Togli Mese dall'asse" }));
    expect(selezioneCorrente().granularita).toBeUndefined();
  });

  it("dall'ultima misura non si toglie, e dice cosa fare", () => {
    render(<Banco iniziale={{ misure: ["ordinato"], suddivisioni: [] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Togli Valore ordinato dai valori" }));
    expect(messaggio()).toHaveTextContent("Serve almeno una misura");
    expect(selezioneCorrente().misure).toEqual(["ordinato"]);
  });

  it("una misura fra piu' si toglie", () => {
    render(<Banco iniziale={{ misure: ["ordinato", "fatturato"], suddivisioni: [] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Togli Valore fatturato dai valori" }));
    expect(selezioneCorrente().misure).toEqual(["ordinato"]);
  });

  it("i valori si riordinano con le frecce: la prima e' la principale", () => {
    render(<Banco iniziale={{ misure: ["ordinato", "fatturato", "n_ordini"], suddivisioni: [] }} />);
    expect(screen.queryByRole("button", { name: "Sposta «Valore ordinato» prima" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sposta «Numero ordini» prima" }));
    expect(selezioneCorrente().misure).toEqual(["ordinato", "n_ordini", "fatturato"]);
    fireEvent.click(screen.getByRole("button", { name: "Sposta «Numero ordini» prima" }));
    expect(selezioneCorrente().misure).toEqual(["n_ordini", "ordinato", "fatturato"]);
    expect(within(pozzetto("Valori")).getByText(/principale/).closest("li")).toHaveTextContent("Numero ordini");
  });

  it("togliere un filtro", () => {
    render(<Banco iniziale={{ misure: ["ordinato"], suddivisioni: [] }} filtriIniziali={[{ campo: "cliente", op: "in", valore: ["Boni"] }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Togli il filtro su Cliente" }));
    expect(within(pozzetto("Filtri")).queryByText(/Cliente:/)).not.toBeInTheDocument();
  });
});

describe("Pozzetti: il menu, l'alternativa al trascinamento", () => {
  it("Asse offre il tempo e le dimensioni ammesse, non quelle che non valgono per la misura", () => {
    render(<Banco iniziale={{ misure: ["ordinato"], suddivisioni: [] }} />);
    const menu = within(pozzetto("Asse")).getByLabelText("Aggiungi a Asse");
    const opzioni = within(menu).getAllByRole("option").map((o) => o.textContent);
    expect(opzioni).toContain("Mese");
    expect(opzioni).toContain("Cliente");
    expect(opzioni).not.toContain("Esito");
  });

  it("scegliere una voce dal menu fa lo stesso del trascinamento", () => {
    render(<Banco iniziale={{ misure: ["ordinato"], suddivisioni: [] }} />);
    fireEvent.change(within(pozzetto("Asse")).getByLabelText("Aggiungi a Asse"), { target: { value: "dimensione:cliente" } });
    expect(selezioneCorrente().suddivisioni).toEqual(["cliente"]);
    fireEvent.change(within(pozzetto("Valori")).getByLabelText("Aggiungi a Valori"), { target: { value: "misura:fatturato" } });
    expect(selezioneCorrente().misure).toEqual(["ordinato", "fatturato"]);
    fireEvent.change(within(pozzetto("Filtri")).getByLabelText("Aggiungi a Filtri"), { target: { value: "dimensione:agente" } });
    expect(within(pozzetto("Filtri")).getByText("Agente: da scegliere")).toBeInTheDocument();
  });

  it("Valori elenca le misure raggruppate per tipologia, senza quelle gia' scelte", () => {
    render(<Banco iniziale={{ misure: ["ordinato"], suddivisioni: [] }} />);
    const menu = within(pozzetto("Valori")).getByLabelText("Aggiungi a Valori");
    const gruppi = within(menu).getAllByRole("group").map((g) => g.getAttribute("label"));
    expect(gruppi).toContain("Fatturato");
    expect(gruppi).toContain("Budget");
    expect(within(menu).queryByRole("option", { name: "Valore ordinato" })).not.toBeInTheDocument();
    expect(within(menu).getByRole("option", { name: "Numero ordini" })).toBeInTheDocument();
  });

  it("la Legenda non offre niente finche' non c'e' un asse, e lo dice nel menu", () => {
    render(<Banco iniziale={{ misure: ["ordinato"], suddivisioni: [] }} />);
    const menu = within(pozzetto("Legenda")).getByLabelText("Aggiungi a Legenda");
    expect(menu).toBeDisabled();
    expect(within(menu).getByRole("option", { name: "Niente da aggiungere" })).toBeInTheDocument();
  });

  it("senza misura nessun menu di suddivisione offre niente", () => {
    render(<Banco />);
    expect(within(pozzetto("Asse")).getByLabelText("Aggiungi a Asse")).toBeDisabled();
    expect(within(pozzetto("Filtri")).getByLabelText("Aggiungi a Filtri")).toBeDisabled();
    expect(within(pozzetto("Valori")).getByLabelText("Aggiungi a Valori")).toBeEnabled();
  });
});

describe("Pozzetti: i gesti non lasciano mai piu' di due suddivisioni", () => {
  it("qualunque sequenza di rilasci", () => {
    render(<Banco iniziale={{ misure: ["ordinato"], suddivisioni: [] }} />);
    const gesti: Array<[string, VoceCampo]> = [
      ["Asse", dim("bu")], ["Legenda", dim("agente")], ["Asse", dim("cliente")], ["Legenda", dim("bu")],
      ["Asse", tempo("mese")], ["Legenda", dim("cliente")], ["Asse", dim("agente")], ["Asse", tempo("anno")],
      ["Legenda", dim("bu")], ["Asse", dim("bu")],
    ];
    for (const [nome, voce] of gesti) {
      rilascia(nome, voce);
      const s = selezioneCorrente();
      expect(s.suddivisioni.length).toBeLessThanOrEqual(2);
      expect(new Set(s.suddivisioni).size).toBe(s.suddivisioni.length);
    }
  });
});

describe("la selezione vuota resta utilizzabile", () => {
  it("SELEZIONE_VUOTA parte da pozzetti vuoti e il primo rilascio nei valori la accende", () => {
    render(<Banco iniziale={SELEZIONE_VUOTA} />);
    rilascia("Valori", misura("fatturato"));
    expect(selezioneCorrente()).toMatchObject({ misure: ["fatturato"], suddivisioni: [] });
    vi.clearAllMocks();
  });
});
