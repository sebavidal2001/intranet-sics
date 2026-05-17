import { dispatchTool } from "./tool-handlers";
import {
  TOOL_LIST_PREVENTIVI_DEF,
  TOOL_CERCA_SIMILI_DEF,
  TOOL_CERCA_ARTICOLO_DEF,
  TOOL_AGGREGA_DEF,
  TOOL_QUERY_RIGHE_DEF,
  TOOL_TOP_ARTICOLI_DEF,
  TOOL_DETTAGLIO_DEF,
  TOOL_ANALISI_SQL_DEF,
  TOOL_ANOMALIE_DEF,
} from "./tool-definitions";
import type { ChatMessage, ToolName, ChatHandlerResult } from "./types";

type OpenRouterUsage = {
  completion_tokens?: number;
  prompt_tokens?: number;
  total_tokens?: number;
  cost?: number;
}

// ─── OpenRouter tool definitions ──────────────────────────────────────────────

const OPENROUTER_TOOLS = [
  {
    type: "function",
    function: {
      name: TOOL_LIST_PREVENTIVI_DEF.name,
      description: TOOL_LIST_PREVENTIVI_DEF.description,
      parameters: { type: "object", properties: TOOL_LIST_PREVENTIVI_DEF.parameters_obj, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: TOOL_CERCA_SIMILI_DEF.name,
      description: TOOL_CERCA_SIMILI_DEF.description,
      parameters: { type: "object", properties: TOOL_CERCA_SIMILI_DEF.parameters_obj, required: TOOL_CERCA_SIMILI_DEF.required },
    },
  },
  {
    type: "function",
    function: {
      name: TOOL_CERCA_ARTICOLO_DEF.name,
      description: TOOL_CERCA_ARTICOLO_DEF.description,
      parameters: { type: "object", properties: TOOL_CERCA_ARTICOLO_DEF.parameters_obj, required: TOOL_CERCA_ARTICOLO_DEF.required },
    },
  },
  {
    type: "function",
    function: {
      name: TOOL_AGGREGA_DEF.name,
      description: TOOL_AGGREGA_DEF.description,
      parameters: { type: "object", properties: TOOL_AGGREGA_DEF.parameters_obj, required: TOOL_AGGREGA_DEF.required },
    },
  },
  {
    type: "function",
    function: {
      name: TOOL_TOP_ARTICOLI_DEF.name,
      description: TOOL_TOP_ARTICOLI_DEF.description,
      parameters: { type: "object", properties: TOOL_TOP_ARTICOLI_DEF.parameters_obj, required: TOOL_TOP_ARTICOLI_DEF.required },
    },
  },
  {
    type: "function",
    function: {
      name: TOOL_QUERY_RIGHE_DEF.name,
      description: TOOL_QUERY_RIGHE_DEF.description,
      parameters: { type: "object", properties: TOOL_QUERY_RIGHE_DEF.parameters_obj, required: TOOL_QUERY_RIGHE_DEF.required },
    },
  },
  {
    type: "function",
    function: {
      name: TOOL_DETTAGLIO_DEF.name,
      description: TOOL_DETTAGLIO_DEF.description,
      parameters: { type: "object", properties: TOOL_DETTAGLIO_DEF.parameters_obj, required: TOOL_DETTAGLIO_DEF.required },
    },
  },
  {
    type: "function",
    function: {
      name: TOOL_ANALISI_SQL_DEF.name,
      description: TOOL_ANALISI_SQL_DEF.description,
      parameters: { type: "object", properties: TOOL_ANALISI_SQL_DEF.parameters_obj, required: TOOL_ANALISI_SQL_DEF.required },
    },
  },
  {
    type: "function",
    function: {
      name: TOOL_ANOMALIE_DEF.name,
      description: TOOL_ANOMALIE_DEF.description,
      parameters: { type: "object", properties: TOOL_ANOMALIE_DEF.parameters_obj, required: TOOL_ANOMALIE_DEF.required },
    },
  },
];

// ─── OpenRouter handler ───────────────────────────────────────────────────────

export async function handleOpenRouter(
  messages: ChatMessage[],
  systemInstruction: string,
  temperature: number = 0.2,
  top_p: number = 0.9,
  configuredModel?: string
): Promise<ChatHandlerResult> {
  const apiKey = process.env.OPENROUTER_API_KEY!;
  const model = configuredModel?.trim() || process.env.OPENROUTER_MODEL || "anthropic/claude-haiku-4-5";

  const isAnthropicModel = model.startsWith("anthropic/");
  const openaiMessages: Array<Record<string, unknown>> = [
    {
      role: "system",
      content: systemInstruction,
      ...(isAnthropicModel && { cache_control: { type: "ephemeral" } }),
    },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ];

  const call = async (msgs: Array<Record<string, unknown>>) => {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://intranet-sics.vercel.app",
        "X-Title": "SICS Preventivatore",
      },
      body: JSON.stringify({ model, messages: msgs, tools: OPENROUTER_TOOLS, tool_choice: "auto", temperature, top_p, max_tokens: 2048 }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(err?.error?.message ?? `OpenRouter HTTP ${res.status}`);
    }
    return res.json() as Promise<{
      choices: Array<{
        message: {
          role: string;
          content: string | null;
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
        };
      }>;
      usage?: OpenRouterUsage;
    }>;
  };

  const totalUsage: Required<OpenRouterUsage> = {
    completion_tokens: 0,
    prompt_tokens: 0,
    total_tokens: 0,
    cost: 0,
  };
  let hasUsage = false;

  const addUsage = (usage?: OpenRouterUsage) => {
    if (!usage) return;
    hasUsage = true;
    totalUsage.completion_tokens += usage.completion_tokens ?? 0;
    totalUsage.prompt_tokens += usage.prompt_tokens ?? 0;
    totalUsage.total_tokens += usage.total_tokens ?? 0;
    totalUsage.cost += usage.cost ?? 0;
  };

  const buildUsage = (): ChatHandlerResult["usage"] => {
    if (!hasUsage) return null;
    return {
      provider: "openrouter",
      model,
      prompt_tokens: totalUsage.prompt_tokens || null,
      completion_tokens: totalUsage.completion_tokens || null,
      total_tokens: totalUsage.total_tokens || null,
      cost: totalUsage.cost || null,
      currency: "usd",
      source: "exact",
    };
  };

  // Multi-step tool loop
  const MAX_ROUNDS = 6;
  let currentMessages = [...openaiMessages];
  let lastToolName: ToolName | null = null;
  let lastRisultati: unknown[] | null = null;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const data = await call(currentMessages);
    addUsage(data.usage);
    const msg = data.choices[0].message;

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return { risposta: msg.content ?? "", tool_usato: lastToolName, risultati: lastRisultati, usage: buildUsage() };
    }

    const toolCall = msg.tool_calls[0];
    const toolName = toolCall.function.name as ToolName;
    const toolArgs = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;

    let toolResult: unknown;
    let risultatiTool: unknown[] | null = null;

    try {
      const res = await dispatchTool(toolName, toolArgs);
      toolResult = res;
      risultatiTool = res as unknown[];
    } catch (err) {
      console.error(`Tool ${toolName} error:`, err);
      toolResult = { error: err instanceof Error ? err.message : "Errore esecuzione tool" };
    }

    lastToolName = toolName;
    lastRisultati = risultatiTool;

    currentMessages = [
      ...currentMessages,
      { role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls },
      { role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(toolResult) },
    ];
  }

  // Superato MAX_ROUNDS: forza una risposta finale senza ulteriori tool calls
  const fallbackData = await call([
    ...currentMessages,
    { role: "user", content: "Per favore rispondi all'utente basandoti sui dati che hai già raccolto." },
  ]);
  addUsage(fallbackData.usage);
  return {
    risposta: fallbackData.choices[0].message.content ?? "",
    tool_usato: lastToolName,
    risultati: lastRisultati,
    usage: buildUsage(),
  };
}
