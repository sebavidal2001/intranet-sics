/**
 * I pozzetti: dove puo' andare cosa. Ogni gesto passa dalle stesse funzioni
 * dell'albero, quindi qui si prova soprattutto che ogni combinazione abbia un
 * esito chiaro — un effetto preciso o un rifiuto con il suo motivo — e che mai
 * si superino le due suddivisioni.
 */
import { describe, expect, it, vi } from "vitest";
import {
  contenutoPozzetti,
  deponi,
  iscriviTrascinamento,
  impostaTrascinamento,
  leggiTrascinamento,
  leggiVoceDalTrasferimento,
  spostaValore,
  togliVoce,
  vociDisponibili,
  type ContestoPozzetti,
  type VoceCampo,
} from "@/components/prototipo-bi/pozzetti-regole";
import { selezioneConSuddivisione, type SelezioneCampi } from "@/components/prototipo-bi/albero-campi";
import type { Dimensione } from "@/lib/prototipo-bi/tipi";

const COMUNI: Dimensione[] = ["bu", "agente", "cliente", "categoria"];

const ETICHETTE: Record<string, string> = {
  ordinato: "Ordinato",
  fatturato: "Fatturato",
  n_ordini: "Numero ordini",
  budget: "Budget",
  preventivi_valore: "Valore preventivi",
  bu: "Business unit",
  agente: "Agente",
  cliente: "Cliente",
  categoria: "Categoria",
  esito: "Esito",
  giorno: "Giorno",
  mese: "Mese",
  anno: "Anno",
};

const CONTESTO: ContestoPozzetti = {
  perMetrica: {
    ordinato: COMUNI,
    fatturato: COMUNI,
    n_ordini: COMUNI,
    // Il vocabolario dichiara il budget su tutte le dimensioni comuni: e' il
    // controllo a parte (`ammetteConfrontoBudget`) che lo ferma fuori da bu e agente.
    budget: COMUNI,
    preventivi_valore: [...COMUNI, "esito"],
  },
  etichetta: (v) => ETICHETTE[v.chiave] ?? v.chiave,
};

const misura = (chiave: string): VoceCampo => ({ tipo: "misura", chiave: chiave as never });
const dim = (chiave: Dimensione): VoceCampo => ({ tipo: "dimensione", chiave });
const tempo = (chiave: "giorno" | "mese" | "anno"): VoceCampo => ({ tipo: "calendario", chiave });

function sel(over: Partial<SelezioneCampi> = {}): SelezioneCampi {
  return { misure: ["ordinato"], suddivisioni: [], ...over };
}

function accetta(esito: ReturnType<typeof deponi>) {
  if (!esito.ok) throw new Error(`rifiutato: ${esito.motivo}`);
  return esito;
}

function rifiuto(esito: ReturnType<typeof deponi>): string {
  if (esito.ok) throw new Error("doveva rifiutare");
  return esito.motivo;
}

describe("come la selezione si legge nei pozzetti", () => {
  it("senza tempo: asse = prima dimensione, legenda = seconda", () => {
    const c = contenutoPozzetti(sel({ suddivisioni: ["bu", "agente"], misure: ["ordinato", "fatturato"] }));
    expect(c.asse).toEqual(dim("bu"));
    expect(c.legenda).toEqual([dim("agente")]);
    expect(c.valori).toEqual(["ordinato", "fatturato"]);
  });

  it("con il tempo: asse = tempo, legenda = la dimensione", () => {
    const c = contenutoPozzetti(sel({ suddivisioni: ["bu"], granularita: "mese" }));
    expect(c.asse).toEqual(tempo("mese"));
    expect(c.legenda).toEqual([dim("bu")]);
  });

  it("selezione vuota di suddivisioni: pozzetti vuoti", () => {
    const c = contenutoPozzetti(sel());
    expect(c.asse).toBeNull();
    expect(c.legenda).toEqual([]);
  });

  it("oltre il limite (tempo e due dimensioni) la legenda le mostra tutte, per poterle togliere", () => {
    const c = contenutoPozzetti(sel({ suddivisioni: ["bu", "agente"], granularita: "mese" }));
    expect(c.legenda).toEqual([dim("bu"), dim("agente")]);
  });
});

describe("Valori", () => {
  it("accoglie una misura", () => {
    const e = accetta(deponi(sel(), "valori", misura("fatturato"), CONTESTO));
    expect(e.selezione.misure).toEqual(["ordinato", "fatturato"]);
  });

  it("rifiuta una dimensione, il tempo e una misura gia' presente, col motivo", () => {
    expect(rifiuto(deponi(sel(), "valori", dim("cliente"), CONTESTO))).toContain("Nei valori vanno le misure");
    expect(rifiuto(deponi(sel(), "valori", tempo("mese"), CONTESTO))).toContain("Nei valori vanno le misure");
    expect(rifiuto(deponi(sel(), "valori", misura("ordinato"), CONTESTO))).toBe("«Ordinato» è già nei valori.");
  });

  it("rifiuta una misura incompatibile con le suddivisioni gia' scelte", () => {
    const motivo = rifiuto(deponi(sel({ suddivisioni: ["esito"] as Dimensione[] }), "valori", misura("fatturato"), CONTESTO));
    expect(motivo).toMatch(/non si può suddividere per esito/);
  });

  it("la prima misura puo' essere lasciata anche se non c'era niente", () => {
    const e = accetta(deponi(sel({ misure: [] }), "valori", misura("ordinato"), CONTESTO));
    expect(e.selezione.misure).toEqual(["ordinato"]);
  });
});

describe("Asse", () => {
  it("una dimensione sull'asse vuoto", () => {
    expect(accetta(deponi(sel(), "asse", dim("cliente"), CONTESTO)).selezione.suddivisioni).toEqual(["cliente"]);
  });

  it("senza misura si puo' partire dal divisore: la dimensione entra e le misure si scelgono dopo", () => {
    expect(accetta(deponi(sel({ misure: [] }), "asse", dim("cliente"), CONTESTO)).selezione.suddivisioni).toEqual(["cliente"]);
  });

  it("una dimensione nuova SOSTITUISCE quella dell'asse, tiene la legenda, e lo dice", () => {
    const e = accetta(deponi(sel({ suddivisioni: ["bu", "agente"] }), "asse", dim("cliente"), CONTESTO));
    expect(e.selezione.suddivisioni).toEqual(["cliente", "agente"]);
    expect(e.avviso).toBe("«Cliente» ha preso il posto di «Business unit» sull'asse.");
  });

  it("una dimensione che era in legenda passa all'asse e le due si scambiano", () => {
    const e = accetta(deponi(sel({ suddivisioni: ["bu", "agente"] }), "asse", dim("agente"), CONTESTO));
    expect(e.selezione.suddivisioni).toEqual(["agente", "bu"]);
  });

  it("la stessa dimensione gia' sull'asse non cambia niente (stessa selezione)", () => {
    const s = sel({ suddivisioni: ["bu"] });
    const e = accetta(deponi(s, "asse", dim("bu"), CONTESTO));
    expect(e.selezione).toBe(s);
    expect(e.avviso).toBeUndefined();
  });

  it("il tempo sull'asse: imposta la granularita' e prende il posto di quello che c'era", () => {
    const e = accetta(deponi(sel({ suddivisioni: ["bu", "agente"] }), "asse", tempo("mese"), CONTESTO));
    expect(e.selezione.granularita).toBe("mese");
    // L'asse era «bu»: il tempo la sostituisce, la legenda «agente» resta.
    expect(e.selezione.suddivisioni).toEqual(["agente"]);
    expect(e.avviso).toBe("Il tempo ha preso il posto di «Business unit» sull'asse.");
  });

  it("il tempo cambia granularita' senza toccare la legenda", () => {
    const e = accetta(deponi(sel({ suddivisioni: ["bu"], granularita: "mese" }), "asse", tempo("anno"), CONTESTO));
    expect(e.selezione.granularita).toBe("anno");
    expect(e.selezione.suddivisioni).toEqual(["bu"]);
    expect(e.avviso).toBeUndefined();
  });

  it("una dimensione sull'asse quando c'e' il tempo toglie il tempo e la legenda scala", () => {
    const e = accetta(deponi(sel({ suddivisioni: ["bu"], granularita: "mese" }), "asse", dim("cliente"), CONTESTO));
    expect(e.selezione.granularita).toBeUndefined();
    expect(e.selezione.suddivisioni).toEqual(["cliente", "bu"]);
    expect(e.avviso).toContain("ha preso il posto del tempo");
  });

  it("una dimensione che non vale per la misura e' rifiutata con il suo motivo", () => {
    expect(rifiuto(deponi(sel(), "asse", dim("esito"), CONTESTO))).toBe("Solo per i preventivi");
  });

  it("una misura sull'asse: rifiutata, va nei valori", () => {
    expect(rifiuto(deponi(sel(), "asse", misura("fatturato"), CONTESTO))).toContain("vanno nei valori");
  });

  it("mai oltre due suddivisioni, qualunque sia la sequenza di gesti", () => {
    let s = sel();
    const gesti: Array<[Parameters<typeof deponi>[1], VoceCampo]> = [
      ["asse", dim("bu")], ["legenda", dim("agente")], ["asse", dim("cliente")], ["legenda", dim("categoria")],
      ["asse", tempo("mese")], ["legenda", dim("bu")], ["asse", dim("agente")], ["asse", tempo("anno")],
    ];
    for (const [pozzetto, voce] of gesti) {
      const e = deponi(s, pozzetto, voce, CONTESTO);
      if (e.ok) s = e.selezione;
      expect(s.suddivisioni.length).toBeLessThanOrEqual(2);
      expect(new Set(s.suddivisioni).size).toBe(s.suddivisioni.length);
    }
  });
});

describe("Legenda", () => {
  it("serve prima l'asse: la legenda suddivide l'asse", () => {
    expect(rifiuto(deponi(sel(), "legenda", dim("agente"), CONTESTO))).toContain("Metti prima qualcosa sull'asse");
  });

  it("una dimensione nella legenda", () => {
    const e = accetta(deponi(sel({ suddivisioni: ["bu"] }), "legenda", dim("agente"), CONTESTO));
    expect(e.selezione.suddivisioni).toEqual(["bu", "agente"]);
  });

  it("sostituisce la legenda precedente e lo dice", () => {
    const e = accetta(deponi(sel({ suddivisioni: ["bu", "agente"] }), "legenda", dim("cliente"), CONTESTO));
    expect(e.selezione.suddivisioni).toEqual(["bu", "cliente"]);
    expect(e.avviso).toBe("«Cliente» ha preso il posto di «Agente» nella legenda.");
  });

  it("la dimensione dell'asse nella legenda: scambio se c'e' una legenda, rifiuto se l'asse e' solo", () => {
    expect(accetta(deponi(sel({ suddivisioni: ["bu", "agente"] }), "legenda", dim("bu"), CONTESTO)).selezione.suddivisioni).toEqual(["agente", "bu"]);
    expect(rifiuto(deponi(sel({ suddivisioni: ["bu"] }), "legenda", dim("bu"), CONTESTO))).toContain("è già sull'asse");
  });

  it("con il tempo sull'asse la legenda e' l'unica dimensione", () => {
    const e = accetta(deponi(sel({ granularita: "mese" }), "legenda", dim("bu"), CONTESTO));
    expect(e.selezione.suddivisioni).toEqual(["bu"]);
    const e2 = accetta(deponi(e.selezione, "legenda", dim("agente"), CONTESTO));
    expect(e2.selezione.suddivisioni).toEqual(["agente"]);
    expect(e2.selezione.granularita).toBe("mese");
  });

  it("il tempo nella legenda e' rifiutato: va sull'asse", () => {
    expect(rifiuto(deponi(sel({ suddivisioni: ["bu"] }), "legenda", tempo("mese"), CONTESTO))).toContain("Il tempo va sull'asse");
  });

  it("la stessa dimensione gia' in legenda non cambia niente", () => {
    const s = sel({ suddivisioni: ["bu", "agente"] });
    expect(accetta(deponi(s, "legenda", dim("agente"), CONTESTO)).selezione).toBe(s);
  });
});

describe("misure che non reggono la nuova suddivisione", () => {
  it("il budget accanto a una suddivisione per cliente viene tolto, e il gesto lo dice", () => {
    const s = sel({ misure: ["ordinato", "budget"] });
    const e = accetta(deponi(s, "asse", dim("cliente"), CONTESTO));
    expect(e.selezione.misure).toEqual(["ordinato"]);
    expect(e.avviso).toBe("Ho tolto «Budget»: non esiste per questa suddivisione.");
  });

  it("il budget resta con business unit e agente", () => {
    const s = sel({ misure: ["ordinato", "budget"] });
    const e = accetta(deponi(s, "asse", dim("bu"), CONTESTO));
    expect(e.selezione.misure).toEqual(["ordinato", "budget"]);
    expect(e.avviso).toBeUndefined();
  });
});

describe("Filtri", () => {
  it("una dimensione e' accolta e chiede a chi chiama di aggiungere il filtro; la selezione non cambia", () => {
    const s = sel();
    const e = accetta(deponi(s, "filtri", dim("cliente"), CONTESTO));
    expect(e.aggiungiFiltroSu).toBe("cliente");
    expect(e.selezione).toBe(s);
  });

  it("misura e tempo sono rifiutati, con il motivo", () => {
    expect(rifiuto(deponi(sel(), "filtri", misura("fatturato"), CONTESTO))).toContain("non le misure");
    expect(rifiuto(deponi(sel(), "filtri", tempo("mese"), CONTESTO))).toContain("riquadro «Quando»");
  });

  it("con una dimensione che la misura non ha, rifiuta; senza misura vale cio' che qualche misura sa usare", () => {
    expect(accetta(deponi(sel({ misure: [] }), "filtri", dim("cliente"), CONTESTO)).aggiungiFiltroSu).toBe("cliente");
    expect(rifiuto(deponi(sel(), "filtri", dim("esito"), CONTESTO))).toBe("Solo per i preventivi");
  });
});

describe("togliere", () => {
  it("anche l'ultima misura si toglie: i campi restano, si puo' ripartire dal divisore; l'errore c'e' solo al salvataggio", () => {
    const e = accetta(togliVoce(sel({ misure: ["ordinato"], suddivisioni: ["bu"], granularita: "mese" }), misura("ordinato"), CONTESTO));
    expect(e.selezione.misure).toEqual([]);
    expect(e.selezione.suddivisioni).toEqual(["bu"]);
    expect(e.selezione.granularita).toBe("mese");
  });

  it("una misura fra piu' si toglie", () => {
    const e = accetta(togliVoce(sel({ misure: ["ordinato", "fatturato"] }), misura("fatturato"), CONTESTO));
    expect(e.selezione.misure).toEqual(["ordinato"]);
  });

  it("togliere l'asse fa scalare la legenda, e lo dice", () => {
    const e = accetta(togliVoce(sel({ suddivisioni: ["bu", "agente"] }), dim("bu"), CONTESTO));
    expect(e.selezione.suddivisioni).toEqual(["agente"]);
    expect(e.avviso).toBe("«Agente» è passata dalla legenda all'asse.");
  });

  it("togliere la legenda, o il tempo, non scala niente", () => {
    expect(accetta(togliVoce(sel({ suddivisioni: ["bu", "agente"] }), dim("agente"), CONTESTO)).selezione.suddivisioni).toEqual(["bu"]);
    const senzaTempo = accetta(togliVoce(sel({ suddivisioni: ["bu"], granularita: "mese" }), tempo("mese"), CONTESTO)).selezione;
    expect(senzaTempo.granularita).toBeUndefined();
    expect(senzaTempo.suddivisioni).toEqual(["bu"]);
  });

  it("togliere e rimettere (via albero) da' lo stesso risultato dei pozzetti", () => {
    const viaAlbero = selezioneConSuddivisione(sel({ suddivisioni: ["bu", "agente"] }), "agente", false, CONTESTO.perMetrica);
    const viaPozzetti = accetta(togliVoce(sel({ suddivisioni: ["bu", "agente"] }), dim("agente"), CONTESTO)).selezione;
    expect(viaPozzetti).toEqual(viaAlbero);
  });
});

describe("spostare i valori", () => {
  it("riordina; la prima e' la principale", () => {
    const s = sel({ misure: ["ordinato", "fatturato", "n_ordini"] });
    expect(spostaValore(s, 2, 0).misure).toEqual(["n_ordini", "ordinato", "fatturato"]);
  });

  it("indici fuori campo o uguali non cambiano niente", () => {
    const s = sel({ misure: ["ordinato", "fatturato"] });
    expect(spostaValore(s, 0, 0)).toBe(s);
    expect(spostaValore(s, -1, 1)).toBe(s);
    expect(spostaValore(s, 0, 5)).toBe(s);
  });
});

describe("cosa si puo' offrire in ciascun pozzetto (l'alternativa al trascinamento)", () => {
  const campi = { misure: ["ordinato", "fatturato", "preventivi_valore", "budget"] as never[], dimensioni: ["bu", "agente", "cliente", "esito"] as Dimensione[] };
  const chiavi = (v: VoceCampo[]) => v.map((x) => `${x.tipo}:${x.chiave}`);

  it("Valori: solo le misure compatibili e non gia' presenti", () => {
    const v = vociDisponibili("valori", sel({ suddivisioni: ["bu"] }), CONTESTO, campi);
    expect(chiavi(v)).toEqual(["misura:fatturato", "misura:preventivi_valore", "misura:budget"]);
    const conEsito = vociDisponibili("valori", sel({ suddivisioni: ["esito" as Dimensione] }), CONTESTO, campi);
    expect(chiavi(conEsito)).toEqual(["misura:preventivi_valore"]);
  });

  it("Asse: il calendario e le dimensioni ammesse, senza quella che c'e' gia'", () => {
    const v = vociDisponibili("asse", sel({ suddivisioni: ["bu"] }), CONTESTO, campi);
    expect(chiavi(v)).toContain("calendario:mese");
    expect(chiavi(v)).toContain("dimensione:agente");
    expect(chiavi(v)).not.toContain("dimensione:bu");
    expect(chiavi(v)).not.toContain("dimensione:esito");
  });

  it("Legenda: vuota finche' non c'e' un asse, poi le dimensioni diverse dall'asse; mai il calendario", () => {
    expect(vociDisponibili("legenda", sel(), CONTESTO, campi)).toEqual([]);
    const v = vociDisponibili("legenda", sel({ suddivisioni: ["bu"] }), CONTESTO, campi);
    expect(chiavi(v).sort()).toEqual(["dimensione:agente", "dimensione:cliente"]);
  });

  it("Filtri: le dimensioni che la misura ha", () => {
    const v = vociDisponibili("filtri", sel(), CONTESTO, campi);
    expect(chiavi(v)).toEqual(["dimensione:bu", "dimensione:agente", "dimensione:cliente"]);
  });

  it("tutto cio' che si offre viene accettato dal deposito", () => {
    const s = sel({ suddivisioni: ["bu"] });
    for (const pozzetto of ["valori", "asse", "legenda", "filtri"] as const) {
      for (const voce of vociDisponibili(pozzetto, s, CONTESTO, campi)) {
        expect(deponi(s, pozzetto, voce, CONTESTO).ok).toBe(true);
      }
    }
  });
});

describe("il trascinamento in corso", () => {
  it("si ricorda, avvisa chi ascolta e si dimentica", () => {
    const ascoltatore = vi.fn();
    const smetti = iscriviTrascinamento(ascoltatore);
    impostaTrascinamento(dim("cliente"));
    expect(leggiTrascinamento()).toEqual(dim("cliente"));
    impostaTrascinamento(null);
    expect(leggiTrascinamento()).toBeNull();
    expect(ascoltatore).toHaveBeenCalledTimes(2);
    smetti();
    impostaTrascinamento(dim("bu"));
    expect(ascoltatore).toHaveBeenCalledTimes(2);
    impostaTrascinamento(null);
  });

  it("rilegge dal trasferimento senza fidarsi: solo forme note", () => {
    expect(leggiVoceDalTrasferimento(JSON.stringify(dim("cliente")))).toEqual(dim("cliente"));
    expect(leggiVoceDalTrasferimento(JSON.stringify(tempo("mese")))).toEqual(tempo("mese"));
    expect(leggiVoceDalTrasferimento(JSON.stringify(misura("ordinato")))).toEqual(misura("ordinato"));
    expect(leggiVoceDalTrasferimento(JSON.stringify({ tipo: "calendario", chiave: "lustro" }))).toBeNull();
    expect(leggiVoceDalTrasferimento(JSON.stringify({ tipo: "script", chiave: "x" }))).toBeNull();
    expect(leggiVoceDalTrasferimento(JSON.stringify({ tipo: "dimensione" }))).toBeNull();
    expect(leggiVoceDalTrasferimento("{non json")).toBeNull();
    expect(leggiVoceDalTrasferimento("")).toBeNull();
    expect(leggiVoceDalTrasferimento(undefined)).toBeNull();
  });
});
