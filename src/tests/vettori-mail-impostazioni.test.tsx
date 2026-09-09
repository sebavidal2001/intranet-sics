import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MailImpostazioni } from "@/components/portali/vettori/mail-impostazioni";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("eredita il modello generale e salva indirizzi specifici mantenendo la conferma", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ modelli: [{ vettore_id: null, oggetto: "Controllo {mese}", corpo: "Dettaglio {tabella}", destinatari: ["generale@example.com"], cc: [] }] }) });
  vi.stubGlobal("fetch", fetchMock);
  const id = "00000000-0000-4000-8000-000000000001";
  render(<MailImpostazioni vettori={[{ id, nome: "GLS" }]} />);
  await waitFor(() => expect((screen.getByLabelText("Oggetto") as HTMLInputElement).value).toBe("Controllo {mese}"));
  fireEvent.change(screen.getByLabelText("Modello"), { target: { value: id } });
  expect((screen.getByLabelText("Testo") as HTMLTextAreaElement).value).toBe("Dettaglio {tabella}");
  fireEvent.change(screen.getByLabelText(/A — separa/), { target: { value: "uno@example.com; due@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Salva modello email" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Modello e indirizzi salvati."));
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ vettore_id: id, destinatari: ["uno@example.com", "due@example.com"], cc: [] });
});
