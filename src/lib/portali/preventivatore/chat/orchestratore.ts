import { ZodError } from "zod";
import { TOOL_DEFINITIONS } from "./tool-definitions";
import { dispatchTool, type ChatToolScope } from "./tool-handlers";
import { validaArgomentiTool } from "./tool-args";
import type { ChatMessage, FonteTool, ToolName } from "./types";

export const MAX_ROUNDS = 6;
export const MAX_TOOL_PARALLELI = 4;
export const MAX_CARATTERI_STORIA = 60_000;

const nomiTool = new Set<string>(TOOL_DEFINITIONS.map((definizione) => definizione.name));

export interface ChiamataTool {
  id: string;
  nome: string;
  argomenti: unknown;
}

export interface EsitoTool {
  id: string;
  nome: ToolName | null;
  argomenti: Record<string, unknown> | null;
  risultato: unknown;
  mostrabile: boolean;
}

function erroreTool(errore: unknown): { errore: string } {
  if (errore instanceof ZodError) {
    return { errore: `Argomenti non validi: ${errore.issues.map((issue) => issue.message).join("; ")}` };
  }
  return { errore: errore instanceof Error ? errore.message : "Errore esecuzione tool" };
}

async function eseguiSingola(chiamata: ChiamataTool, scope?: ChatToolScope): Promise<EsitoTool> {
  if (!nomiTool.has(chiamata.nome)) {
    return { id: chiamata.id, nome: null, argomenti: null, risultato: { errore: `Tool sconosciuto: ${chiamata.nome}` }, mostrabile: false };
  }

  const nome = chiamata.nome as ToolName;
  try {
    const grezzi = typeof chiamata.argomenti === "string" ? JSON.parse(chiamata.argomenti) : chiamata.argomenti;
    const argomenti = validaArgomentiTool(nome, grezzi);
    const risultato = await dispatchTool(nome, argomenti, scope);
    return { id: chiamata.id, nome, argomenti, risultato, mostrabile: true };
  } catch (errore) {
    return { id: chiamata.id, nome, argomenti: null, risultato: erroreTool(errore), mostrabile: false };
  }
}

/** Esegue tutte le chiamate del turno, al massimo quattro alla volta. */
export async function eseguiChiamateTool(chiamate: ChiamataTool[], scope?: ChatToolScope): Promise<EsitoTool[]> {
  const esiti: EsitoTool[] = [];
  for (let indice = 0; indice < chiamate.length; indice += MAX_TOOL_PARALLELI) {
    esiti.push(...await Promise.all(chiamate.slice(indice, indice + MAX_TOOL_PARALLELI).map((chiamata) => eseguiSingola(chiamata, scope))));
  }
  return esiti;
}

export function serializzaDatiNonFidati(esito: EsitoTool): string {
  return JSON.stringify({ dati_non_fidati: esito.risultato });
}

export function fontiDaEsiti(esiti: EsitoTool[]): FonteTool[] {
  const conteggi = new Map<ToolName, number>();
  for (const esito of esiti) {
    if (esito.nome) conteggi.set(esito.nome, (conteggi.get(esito.nome) ?? 0) + 1);
  }
  return [...conteggi].map(([tool, n]) => ({ tool, n }));
}

export function ultimoRisultatoMostrabile(esiti: EsitoTool[]): { tool: ToolName | null; risultati: unknown } {
  const ultimo = [...esiti].reverse().find((esito) => esito.nome && esito.mostrabile);
  return { tool: ultimo?.nome ?? null, risultati: ultimo?.risultato ?? null };
}

/** Conserva i messaggi più recenti entro il budget e rende esplicito il taglio. */
export function troncaStoria(messages: ChatMessage[], maxCaratteri = MAX_CARATTERI_STORIA): ChatMessage[] {
  let usati = 0;
  const conservati: ChatMessage[] = [];
  for (let indice = messages.length - 1; indice >= 0; indice--) {
    const messaggio = messages[indice];
    if (usati + messaggio.content.length > maxCaratteri && conservati.length > 0) break;
    const content = messaggio.content.slice(Math.max(0, messaggio.content.length - Math.max(1, maxCaratteri - usati)));
    conservati.unshift({ ...messaggio, content });
    usati += content.length;
    if (usati >= maxCaratteri) break;
  }
  // Gemini e Anthropic vogliono che la conversazione cominci da un messaggio utente.
  while (conservati.length > 1 && conservati[0].role !== "user") conservati.shift();
  if (conservati.length < messages.length && conservati[0]) {
    conservati[0] = { ...conservati[0], content: `[Cronologia precedente troncata per limite di contesto]\n${conservati[0].content}` };
  }
  return conservati;
}
