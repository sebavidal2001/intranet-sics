import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useAutoAggiornamento } from "@/components/prototipo-bi/auto-aggiornamento";
import { svuotaCacheQuery, useQueryBi } from "@/components/prototipo-bi/primitivi";
import type { SpecQuery } from "@/lib/prototipo-bi/tipi";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function rispostaSnapshot(runRicevutoIl: string) {
  return { ok: true, json: async () => ({ runRicevutoIl }) };
}

describe("useAutoAggiornamento", () => {
  it("si aggiorna quando il server ha un caricamento diverso da quello a video", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchFinta = vi.fn().mockResolvedValue(rispostaSnapshot("2026-09-24T23:31:22Z"));
    vi.stubGlobal("fetch", fetchFinta);
    const quandoNuovi = vi.fn();

    renderHook(() => useAutoAggiornamento("2026-09-11T23:31:00Z", quandoNuovi));
    await act(async () => {
      vi.advanceTimersByTime(10 * 60 * 1000);
    });
    await waitFor(() => expect(quandoNuovi).toHaveBeenCalledTimes(1));
    expect(fetchFinta).toHaveBeenCalledWith("/api/bi/snapshot", { cache: "no-store" });
  });

  it("non fa niente se il caricamento e' lo stesso", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(rispostaSnapshot("2026-09-24T23:31:22Z")));
    const quandoNuovi = vi.fn();
    renderHook(() => useAutoAggiornamento("2026-09-24T23:31:22Z", quandoNuovi));
    await act(async () => {
      vi.advanceTimersByTime(30 * 60 * 1000);
    });
    expect(quandoNuovi).not.toHaveBeenCalled();
  });

  it("senza riferimento, il primo controllo lo fissa e non scatena niente", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(rispostaSnapshot("2026-09-24T23:31:22Z")));
    const quandoNuovi = vi.fn();
    renderHook(() => useAutoAggiornamento(undefined, quandoNuovi));
    await act(async () => {
      await Promise.resolve();
    });
    expect(quandoNuovi).not.toHaveBeenCalled();
  });
});

describe("svuotaCacheQuery", () => {
  it("fa rileggere i grafici gia' montati, non solo svuota la cache", async () => {
    const fetchFinta = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ risultati: [], dataMassima: "2026-09-24" }),
    });
    vi.stubGlobal("fetch", fetchFinta);
    const specs: Record<string, SpecQuery | null> = { a: { metrica: "ordinato" } };

    renderHook(() => useQueryBi(specs));
    await waitFor(() => expect(fetchFinta).toHaveBeenCalledTimes(1));

    act(() => svuotaCacheQuery());
    await waitFor(() => expect(fetchFinta).toHaveBeenCalledTimes(2));
  });
});
