import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SganciaBolla } from "@/components/portali/vettori/sgancia-bolla";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("sgancio di un aggancio sbagliato", () => {
  it("chiede il motivo e lo manda", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sganciata: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const onSganciata = vi.fn();
    render(<SganciaBolla rigaId="r1" onSganciata={onSganciata} />);
    fireEvent.click(screen.getByRole("button", { name: /Sgancia dalla bolla/ }));
    const conferma = screen.getByRole("button", { name: /Conferma sgancio/ }) as HTMLButtonElement;
    expect(conferma.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: "bolla sbagliata, era la 2734" } });
    expect(conferma.disabled).toBe(false);
    fireEvent.click(conferma);
    await waitFor(() => expect(onSganciata).toHaveBeenCalled());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({ azione: "sgancia", riga: "r1", motivo: "bolla sbagliata, era la 2734" });
  });
});
