import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SganciaBolla } from "@/components/portali/vettori/sgancia-bolla";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function apri() {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sganciata: true }) });
  vi.stubGlobal("fetch", fetchMock);
  const onSganciata = vi.fn();
  render(<SganciaBolla rigaId="r1" onSganciata={onSganciata} />);
  fireEvent.click(screen.getByRole("button", { name: /Sgancia dalla bolla/ }));
  const conferma = screen.getByRole("button", { name: /Conferma sgancio/ }) as HTMLButtonElement;
  return { fetchMock, onSganciata, conferma };
}

describe("sgancio di un aggancio sbagliato", () => {
  it("basta un clic sul motivo pronto", async () => {
    const { fetchMock, onSganciata, conferma } = apri();
    expect(conferma.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Bolla sbagliata" }));
    expect(conferma.disabled).toBe(false);
    fireEvent.click(conferma);
    await waitFor(() => expect(onSganciata).toHaveBeenCalled());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({ azione: "sgancia", riga: "r1", motivo: "Bolla sbagliata" });
  });

  it("la nota facoltativa si aggiunge al motivo", async () => {
    const { fetchMock, onSganciata, conferma } = apri();
    fireEvent.click(screen.getByRole("button", { name: "Bolla sbagliata" }));
    fireEvent.change(screen.getByLabelText(/Nota/), { target: { value: "la giusta è la 2734" } });
    fireEvent.click(conferma);
    await waitFor(() => expect(onSganciata).toHaveBeenCalled());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).motivo).toBe("Bolla sbagliata: la giusta è la 2734");
  });

  it("con «Altro» la spiegazione è obbligatoria", () => {
    const { conferma } = apri();
    fireEvent.click(screen.getByRole("button", { name: "Altro" }));
    expect(conferma.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Spiega il motivo/), { target: { value: "riga di prova" } });
    expect(conferma.disabled).toBe(false);
  });
});
