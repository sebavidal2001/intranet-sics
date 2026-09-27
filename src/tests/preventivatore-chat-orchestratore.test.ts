import { beforeEach, describe, expect, it, vi } from "vitest";

// Collaudo del ciclo dei tool della chat (ricognizione del 27/09/2026): chiamate
// parallele, chiusura senza tool, argomenti sporchi, storia troncata.

const mockDispatch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/portali/preventivatore/chat/tool-handlers", () => ({
  dispatchTool: mockDispatch,
}));

import { handleOpenRouter } from "@/lib/portali/preventivatore/chat/openrouter-handler";
import { troncaStoria, eseguiChiamateTool } from "@/lib/portali/preventivatore/chat/orchestratore";
import { validaArgomentiTool } from "@/lib/portali/preventivatore/chat/tool-args";
import { TOOL_DEFINITIONS } from "@/lib/portali/preventivatore/chat/tool-definitions";
import type { ToolName } from "@/lib/portali/preventivatore/chat/types";

type CorpoRichiesta = {
  messages: Array<{ role: string; tool_call_id?: string; tool_calls?: unknown[] }>;
  tool_choice: string;
};

function rispostaOpenRouter(message: Record<string, unknown>) {
  return new Response(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.001 } }), { status: 200 });
}

describe("handleOpenRouter", () => {
  const corpi: CorpoRichiesta[] = [];

  beforeEach(() => {
    corpi.length = 0;
    mockDispatch.mockReset();
    process.env.OPENROUTER_API_KEY = "chiave-di-prova";
  });

  it("esegue TUTTE le tool call del turno e risponde a ciascun id", async () => {
    mockDispatch.mockImplementation(async (nome: string, args: Record<string, unknown>) => [{ nome, anno: args.anno }]);
    const risposte = [
      rispostaOpenRouter({
        content: null,
        tool_calls: [
          { id: "call_a", function: { name: "list_preventivi", arguments: JSON.stringify({ anno: 2024 }) } },
          { id: "call_b", function: { name: "list_preventivi", arguments: JSON.stringify({ anno: 2026 }) } },
        ],
      }),
      rispostaOpenRouter({ content: "Ecco il confronto." }),
    ];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
      corpi.push(JSON.parse(init.body) as CorpoRichiesta);
      return risposte.shift()!;
    }));

    const esito = await handleOpenRouter([{ role: "user", content: "2024 contro 2026" }], "sistema", 0.2, 0.9, "anthropic/claude-haiku-4.5");

    expect(mockDispatch).toHaveBeenCalledTimes(2);
    const messaggiTool = corpi[1].messages.filter((m) => m.role === "tool");
    expect(messaggiTool.map((m) => m.tool_call_id)).toEqual(["call_a", "call_b"]);
    expect(esito.risposta).toBe("Ecco il confronto.");
    expect(esito.fonti).toEqual([{ tool: "list_preventivi", n: 2 }]);
    expect(esito.usage?.cost).toBeCloseTo(0.002);
  });

  it("dopo il numero massimo di giri chiude con tool_choice none", async () => {
    mockDispatch.mockResolvedValue([]);
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
      const corpo = JSON.parse(init.body) as CorpoRichiesta;
      corpi.push(corpo);
      return corpo.tool_choice === "none"
        ? rispostaOpenRouter({ content: "Conclusione." })
        : rispostaOpenRouter({ content: null, tool_calls: [{ id: `c${corpi.length}`, function: { name: "listino_servizi", arguments: "{}" } }] });
    }));

    const esito = await handleOpenRouter([{ role: "user", content: "domanda" }], "sistema");
    expect(corpi.at(-1)?.tool_choice).toBe("none");
    expect(esito.risposta).toBe("Conclusione.");
  });

  it("argomenti JSON malformati: errore restituito al modello, nessuna eccezione", async () => {
    const esiti = await eseguiChiamateTool([{ id: "x", nome: "list_preventivi", argomenti: "{non json" }]);
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(esiti[0].risultato).toMatchObject({ errore: expect.any(String) });
  });
});

describe("validaArgomentiTool", () => {
  it("tratta null come assente, scarta chiavi ignote e converte i booleani testuali", () => {
    const args = validaArgomentiTool("list_preventivi", { cliente: null, anno: "2025", count_only: "false", inventato: 1 });
    expect(args).toEqual({ anno: 2025, count_only: false });
  });

  it("gli zeri «di riempimento» dei modelli OpenAI valgono come assenti (importo_max: 0 non filtra a zero euro)", () => {
    const args = validaArgomentiTool("list_preventivi", {
      cliente: "", stato: "aperta", anno: 2025, importo_min: 0, importo_max: 0, order_by: "", limit: 0, count_only: true,
    });
    expect(args).toEqual({ stato: "aperta", anno: 2025, count_only: true });
  });

  it("un facoltativo non valido si scarta, un obbligatorio sbagliato resta un errore", () => {
    expect(validaArgomentiTool("list_preventivi", { anno: 2025, limit: 5000 })).toEqual({ anno: 2025 });
    expect(() => validaArgomentiTool("dettaglio_preventivo", {})).toThrow();
  });

  it("ogni tool definito ha uno schema, e lo schema accetta tutti i suoi parametri", () => {
    for (const definizione of TOOL_DEFINITIONS) {
      const nome = definizione.name as ToolName;
      const chiavi = Object.keys(definizione.parameters_obj);
      // Un argomento vuoto per i facoltativi deve passare se non ci sono obbligatori.
      if (definizione.required.length === 0) expect(() => validaArgomentiTool(nome, {})).not.toThrow();
      // Nessun parametro dichiarato al modello deve essere scartato dallo schema.
      const campione: Record<string, unknown> = {};
      for (const chiave of chiavi) {
        const p = definizione.parameters_obj[chiave as keyof typeof definizione.parameters_obj] as { type: string; enum?: readonly string[] };
        campione[chiave] = p.enum ? p.enum[0] : p.type === "number" ? 1 : p.type === "boolean" ? true : "abc";
      }
      let accettati: Record<string, unknown> = {};
      try {
        accettati = validaArgomentiTool(nome, campione);
      } catch {
        // I valori campione possono violare vincoli specifici (enum non dichiarati
        // nelle definizioni): qui interessa solo che le chiavi siano conosciute.
        continue;
      }
      // Numeri e booleani campione sono sempre validi: se spariscono, lo schema
      // non conosce quel parametro (verrebbe scartato in silenzio).
      const attesi = chiavi.filter((k) => {
        const tipo = (definizione.parameters_obj[k as keyof typeof definizione.parameters_obj] as { type: string }).type;
        return tipo === "number" || tipo === "boolean";
      });
      for (const k of attesi) expect(Object.keys(accettati), `tool ${nome}, parametro ${k}`).toContain(k);
      for (const k of Object.keys(accettati)) expect(chiavi, `tool ${nome}`).toContain(k);
    }
  });
});

describe("troncaStoria", () => {
  it("la conversazione conservata comincia sempre da un messaggio utente", () => {
    const storia = troncaStoria([
      { role: "user", content: "a".repeat(50) },
      { role: "assistant", content: "b".repeat(50) },
      { role: "user", content: "c".repeat(50) },
    ], 80);
    expect(storia[0].role).toBe("user");
    expect(storia.at(-1)?.content.endsWith("c".repeat(50))).toBe(true);
  });
});
