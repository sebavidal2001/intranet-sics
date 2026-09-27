import type { ChatMessage } from "./types";

export const MAX_CARATTERI_STORIA = 60_000;

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
