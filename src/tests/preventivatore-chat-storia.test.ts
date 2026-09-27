import { describe, expect, it } from "vitest";
import { MAX_CARATTERI_STORIA, troncaStoria } from "@/lib/portali/preventivatore/chat/storia";

describe("finestra recente della chat", () => {
  it("conserva i messaggi recenti e comincia da un messaggio utente", () => {
    const storia = troncaStoria([
      { role: "user", content: "vecchio".repeat(20) },
      { role: "assistant", content: "risposta".repeat(20) },
      { role: "user", content: "domanda recente" },
    ], 100);
    expect(storia[0].role).toBe("user");
    expect(storia.at(-1)?.content).toContain("domanda recente");
    expect(storia[0].content).toContain("Cronologia precedente troncata");
  });

  it("tronca anche un singolo messaggio assistente molto lungo", () => {
    const storia = troncaStoria([{ role: "assistant", content: "x".repeat(MAX_CARATTERI_STORIA + 500) }]);
    expect(storia).toHaveLength(1);
    expect(storia[0].content.length).toBeLessThanOrEqual(MAX_CARATTERI_STORIA);
  });
});
