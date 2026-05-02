import { GoogleGenerativeAI, SchemaType, type Tool, type Schema } from "@google/generative-ai";
import { dispatchTool } from "./tool-handlers";
import {
  TOOL_LIST_PREVENTIVI_DEF,
  TOOL_CERCA_SIMILI_DEF,
  TOOL_CERCA_ARTICOLO_DEF,
  TOOL_AGGREGA_DEF,
  TOOL_QUERY_RIGHE_DEF,
  TOOL_TOP_ARTICOLI_DEF,
  TOOL_DETTAGLIO_DEF,
} from "./tool-definitions";
import type { ChatMessage, ToolName, ChatHandlerResult } from "./types";

// ─── Gemini helper ────────────────────────────────────────────────────────────

function toGeminiProps(
  obj: Record<string, { type: string; description: string }>
): Record<string, Schema> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k,
      { type: v.type === "number" ? SchemaType.NUMBER : SchemaType.STRING, description: v.description } as Schema,
    ])
  );
}

// ─── Gemini handler ───────────────────────────────────────────────────────────

export async function handleGemini(
  messages: ChatMessage[],
  systemInstruction: string
): Promise<ChatHandlerResult> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

  const tools: Tool[] = [
    {
      functionDeclarations: [
        {
          name: TOOL_LIST_PREVENTIVI_DEF.name,
          description: TOOL_LIST_PREVENTIVI_DEF.description,
          parameters: {
            type: SchemaType.OBJECT,
            properties: toGeminiProps(TOOL_LIST_PREVENTIVI_DEF.parameters_obj),
            required: [],
          },
        },
        {
          name: TOOL_CERCA_SIMILI_DEF.name,
          description: TOOL_CERCA_SIMILI_DEF.description,
          parameters: {
            type: SchemaType.OBJECT,
            properties: toGeminiProps(TOOL_CERCA_SIMILI_DEF.parameters_obj),
            required: TOOL_CERCA_SIMILI_DEF.required,
          },
        },
        {
          name: TOOL_CERCA_ARTICOLO_DEF.name,
          description: TOOL_CERCA_ARTICOLO_DEF.description,
          parameters: {
            type: SchemaType.OBJECT,
            properties: toGeminiProps(TOOL_CERCA_ARTICOLO_DEF.parameters_obj),
            required: TOOL_CERCA_ARTICOLO_DEF.required,
          },
        },
        {
          name: TOOL_AGGREGA_DEF.name,
          description: TOOL_AGGREGA_DEF.description,
          parameters: {
            type: SchemaType.OBJECT,
            properties: toGeminiProps(TOOL_AGGREGA_DEF.parameters_obj),
            required: TOOL_AGGREGA_DEF.required,
          },
        },
        {
          name: TOOL_TOP_ARTICOLI_DEF.name,
          description: TOOL_TOP_ARTICOLI_DEF.description,
          parameters: {
            type: SchemaType.OBJECT,
            properties: toGeminiProps(TOOL_TOP_ARTICOLI_DEF.parameters_obj),
            required: TOOL_TOP_ARTICOLI_DEF.required,
          },
        },
        {
          name: TOOL_QUERY_RIGHE_DEF.name,
          description: TOOL_QUERY_RIGHE_DEF.description,
          parameters: {
            type: SchemaType.OBJECT,
            properties: toGeminiProps(TOOL_QUERY_RIGHE_DEF.parameters_obj),
            required: TOOL_QUERY_RIGHE_DEF.required,
          },
        },
        {
          name: TOOL_DETTAGLIO_DEF.name,
          description: TOOL_DETTAGLIO_DEF.description,
          parameters: {
            type: SchemaType.OBJECT,
            properties: toGeminiProps(TOOL_DETTAGLIO_DEF.parameters_obj),
            required: TOOL_DETTAGLIO_DEF.required,
          },
        },
      ],
    },
  ];

  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", tools, systemInstruction });

  const history = messages.slice(0, -1).map((m) => ({
    role: m.role === "assistant" ? "model" : ("user" as "model" | "user"),
    parts: [{ text: m.content }],
  }));

  const chat = model.startChat({ history });
  const result = await chat.sendMessage(messages[messages.length - 1].content);
  const response = result.response;

  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const functionCallPart = parts.find(
    (p): p is typeof p & { functionCall: { name: string; args: Record<string, unknown> } } =>
      "functionCall" in p && p.functionCall != null
  );

  if (functionCallPart) {
    const { name, args } = functionCallPart.functionCall;
    const toolName = name as ToolName;

    let toolResult: unknown;
    let risultatiTool: unknown[] | null = null;

    try {
      const res = await dispatchTool(toolName, args);
      toolResult = res;
      risultatiTool = res as unknown[];
    } catch (err) {
      console.error(`Tool ${name} error:`, err);
      toolResult = { error: err instanceof Error ? err.message : "Errore esecuzione tool" };
    }

    const result2 = await chat.sendMessage([
      { functionResponse: { name, response: { result: toolResult } } },
    ]);

    return { risposta: result2.response.text(), tool_usato: toolName, risultati: risultatiTool };
  }

  return { risposta: response.text(), tool_usato: null, risultati: null };
}
