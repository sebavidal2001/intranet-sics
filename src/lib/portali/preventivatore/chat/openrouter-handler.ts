import { TOOL_DEFINITIONS } from "./tool-definitions";
import { eseguiChiamateTool, fontiDaEsiti, MAX_ROUNDS, serializzaDatiNonFidati, ultimoRisultatoMostrabile, type EsitoTool } from "./orchestratore";
import type { ChatToolScope } from "./tool-handlers";
import type { ChatHandlerResult, ChatMessage, ChatUsage } from "./types";

type OpenRouterUsage = { completion_tokens?: number; prompt_tokens?: number; total_tokens?: number; cost?: number };
type OpenRouterMessage = { role: string; content: unknown; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>; tool_call_id?: string };

const OPENROUTER_TOOLS = TOOL_DEFINITIONS.map((definizione) => ({
  type: "function",
  function: { name: definizione.name, description: definizione.description, parameters: { type: "object", properties: definizione.parameters_obj, required: definizione.required } },
}));

export class OpenRouterHandlerError extends Error {
  constructor(message: string, public readonly usage: ChatUsage | null) {
    super(message);
    this.name = "OpenRouterHandlerError";
  }
}

export async function handleOpenRouter(messages: ChatMessage[], systemInstruction: string, temperature = 0.2, top_p = 0.9, configuredModel?: string, scope?: ChatToolScope): Promise<ChatHandlerResult> {
  const apiKey = process.env.OPENROUTER_API_KEY!;
  const model = configuredModel?.trim() || process.env.OPENROUTER_MODEL || "anthropic/claude-haiku-4-5";
  const systemContent = model.startsWith("anthropic/") ? [{ type: "text", text: systemInstruction, cache_control: { type: "ephemeral" } }] : systemInstruction;
  let currentMessages: OpenRouterMessage[] = [{ role: "system", content: systemContent }, ...messages.map((messaggio) => ({ role: messaggio.role, content: messaggio.content }))];
  const total = { completion_tokens: 0, prompt_tokens: 0, total_tokens: 0, cost: 0 };
  let hasUsage = false;
  const addUsage = (usage?: OpenRouterUsage) => {
    if (!usage) return;
    hasUsage = true;
    total.completion_tokens += usage.completion_tokens ?? 0;
    total.prompt_tokens += usage.prompt_tokens ?? 0;
    total.total_tokens += usage.total_tokens ?? 0;
    total.cost += usage.cost ?? 0;
  };
  const buildUsage = (): ChatUsage | null => hasUsage ? { provider: "openrouter", model, prompt_tokens: total.prompt_tokens, completion_tokens: total.completion_tokens, total_tokens: total.total_tokens, cost: total.cost, currency: "usd", source: "exact" } : null;
  const call = async (msgs: OpenRouterMessage[], toolChoice: "auto" | "none") => {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", signal: AbortSignal.timeout(30_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, "HTTP-Referer": "https://intranet-sics.vercel.app", "X-Title": "SICS Preventivatore" },
      body: JSON.stringify({ model, messages: msgs, tools: OPENROUTER_TOOLS, tool_choice: toolChoice, temperature, top_p, max_tokens: 2048 }),
    });
    const data = await response.json().catch(() => ({})) as { choices?: Array<{ message: OpenRouterMessage }>; usage?: OpenRouterUsage; error?: { message?: string } };
    addUsage(data.usage);
    if (!response.ok) throw new Error(data.error?.message ?? `OpenRouter HTTP ${response.status}`);
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error("Risposta OpenRouter priva di contenuto");
    return message;
  };

  const tuttiEsiti: EsitoTool[] = [];
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const message = await call(currentMessages, "auto");
      if (!message.tool_calls?.length) {
        const ultimo = ultimoRisultatoMostrabile(tuttiEsiti);
        return { risposta: typeof message.content === "string" ? message.content : "", tool_usato: ultimo.tool, risultati: ultimo.risultati, fonti: fontiDaEsiti(tuttiEsiti), provider: "openrouter", modello: model, fallback: false, usage: buildUsage() };
      }
      const esiti = await eseguiChiamateTool(message.tool_calls.map((chiamata) => ({ id: chiamata.id, nome: chiamata.function.name, argomenti: chiamata.function.arguments })), scope);
      tuttiEsiti.push(...esiti);
      currentMessages = [...currentMessages, { role: "assistant", content: message.content, tool_calls: message.tool_calls }, ...esiti.map((esito) => ({ role: "tool", tool_call_id: esito.id, content: serializzaDatiNonFidati(esito) }))];
    }
    const finale = await call([...currentMessages, { role: "user", content: "Concludi usando soltanto i dati già raccolti. Non chiamare altri tool." }], "none");
    const ultimo = ultimoRisultatoMostrabile(tuttiEsiti);
    return { risposta: typeof finale.content === "string" ? finale.content : "", tool_usato: ultimo.tool, risultati: ultimo.risultati, fonti: fontiDaEsiti(tuttiEsiti), provider: "openrouter", modello: model, fallback: false, usage: buildUsage() };
  } catch (errore) {
    throw new OpenRouterHandlerError(errore instanceof Error ? errore.message : "Errore OpenRouter", buildUsage());
  }
}
