import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ListiniView } from "@/components/portali/vettori/listini-view";
import type { ListinoRiepilogo } from "@/lib/portali/vettori/letture";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/portali/vettori/mail-impostazioni", () => ({ MailImpostazioni: () => null }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const id = "00000000-0000-4000-8000-000000000001";
const listino: ListinoRiepilogo = {
  vettore: { id, codice: "gls", nome: "GLS", modello_tariffa: "scaglioni", divisore_volumetrico: 300, peso_minimo_tassabile: 0, arrotondamento_kg: 0, arrotondamento_da_kg: 0, attivo: true, a_nostro_carico: true },
  listino: { id, etichetta: "Tariffe 2026", valido_dal: "2026-01-19", valido_al: null },
  zone: [{ id, codice: "IT", nome: "Italia", is_default: true, province: [] }],
  fasce: 1, fasceQuintale: 0, supplementi: [], adeguamento: .0721,
  dettaglioFasce: [{ zona_id: id, peso_da: 0, peso_a: null, importo: 8.04, tipo: "fisso", scatto_kg: null, scatto_importo: null }],
  carburante: [{ anno: 2026, mese: 7, percentuale: .13, fonte: "comunicazione" }],
};
/** La richiesta verso un certo endpoint, fra tutte quelle che la pagina ha fatto. */
const chiamata = (mock: { mock: { calls: unknown[][] } }, pezzo: string) =>
  mock.mock.calls.find((c) => String(c[0]).includes(pezzo)) as [string, RequestInit] | undefined;

describe("gestione listini", () => {
  it("mostra il fuel ereditato e salva zero senza alterare il mese originale", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ listini: [listino] }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<ListiniView iniziali={[listino]} anno={2026} mese={9} />);
    expect(screen.getByText(/in vigore: 13% · da luglio 2026/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Percentuale carburante GLS"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Aggiorna" }));
    // La pagina Impostazioni carica anche il riaddebito: la richiesta va cercata
    // per indirizzo, perche' non e' piu' detto che la prima chiamata sia questa.
    await waitFor(() => expect(chiamata(fetchMock, "/carburante")).toBeTruthy());
    expect(JSON.parse(String(chiamata(fetchMock, "/carburante")?.[1]?.body)))
      .toMatchObject({ percentuale: 0, anno: 2026, mese: 9 });
  });
  it("mantiene le tariffe digitate dopo un errore e invia una nuova versione", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Ricaricare il listino" }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<ListiniView iniziali={[listino]} anno={2026} mese={9} />);
    fireEvent.click(screen.getByRole("button", { name: "Modifica tariffe" }));
    fireEvent.change(screen.getByLabelText("Italia, fascia 1, importo"), { target: { value: "9.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Salva nuova versione" }));
    // Con il riaddebito montato nella stessa pagina gli avvisi possono essere
    // piu' di uno: si cerca quello dei listini, non "l'unico".
    await waitFor(() =>
      expect(screen.getAllByRole("alert").map((e) => e.textContent)).toContain("Ricaricare il listino")
    );
    expect((screen.getByLabelText("Italia, fascia 1, importo") as HTMLInputElement).value).toBe("9.5");
    expect(JSON.parse(String(chiamata(fetchMock, "/listini")?.[1]?.body)).fasce[0].importo).toBe(9.5);
  });
});
