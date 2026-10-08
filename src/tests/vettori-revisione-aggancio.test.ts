import { describe, expect, it } from "vitest";
import { abbina, type SpedizioneLogica } from "@/lib/portali/vettori/abbinamento";
import type { RigaFattura } from "@/lib/portali/vettori/fatture/tipi";

const riga: RigaFattura = {
  numero: 1,
  data: "2026-10-01",
  numeroSpedizione: "AWB-1",
  riferimento: "123",
  controparte: "CLIENTE SPA",
  direzione: "uscita",
  colli: 1,
  peso: 5,
  pesoVolumetrico: null,
  pesoTassato: 5,
  nolo: 8,
  supplementi: 0,
  carburante: 0,
  totale: 8,
  dettaglio: {},
};

const spedizione: SpedizioneLogica = {
  chiave: "s1",
  direzione: "uscita",
  riferimento: "123",
  riferimentoNorm: "123",
  dataDocumento: "2026-10-01",
  codiceControparte: "C1",
  controparte: "CLIENTE SPA",
  zonaCap: "20100",
  zonaProvincia: "MI",
  portoCodice: "02",
  porto: "Assegnato",
  aNostroCarico: false,
  vettoreCodice: "GLS",
  colli: 1,
  peso: 5,
  idDocumenti: [1],
};

describe("aggancio a una bolla non a nostro carico", () => {
  it("degrada il numero certo ad assistito", () => {
    const [esito] = abbina([riga], [spedizione]);
    expect(esito.qualita).toBe("assistito");
    expect(esito.spedizione).toBeNull();
    expect(esito.candidati).toEqual([spedizione]);
    expect(esito.motivo).toBe("Bolla non a nostro carico: verificare");
  });
});
