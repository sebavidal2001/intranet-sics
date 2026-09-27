import { createAdminClient } from "@/lib/supabase/admin";
import { logError, logWarn } from "@/lib/logger";
import { calcolaEmbedding } from "./embedding";

interface ChunkDaIndicizzare {
  id: string;
  contenuto: string;
}

interface EsitoIndicizzazione {
  indicizzati: number;
  errori: number;
}

const TIMEOUT_DEFAULT_MS = 15_000;
const PARALLELI = 3;

async function indicizzaChunks(
  chunks: ChunkDaIndicizzare[],
  timeoutMs: number
): Promise<EsitoIndicizzazione> {
  const admin = createAdminClient();
  const scadenza = Date.now() + Math.max(0, timeoutMs);
  let indicizzati = 0;
  let errori = 0;

  // Tre chunk alla volta: in sequenza il salvataggio di un preventivo con due
  // blocchi aspettava ~3,5 s in più; in parallelo circa un terzo.
  let interrotto = false;
  const indicizzaUno = async (chunk: ChunkDaIndicizzare): Promise<void> => {
    if (interrotto) return;
    const residuo = scadenza - Date.now();
    if (residuo <= 0) {
      interrotto = true;
      logWarn("preventivatore.indicizzazione", "Tempo disponibile esaurito", {
        rimanenti: chunks.length - indicizzati - errori,
      });
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("timeout_indicizzazione")), residuo);
      });
      const { vettore, modello } = await Promise.race([
        calcolaEmbedding(chunk.contenuto),
        timeout,
      ]);
      if (timer) clearTimeout(timer);

      const { error } = await admin
        .schema("preventivatore")
        .from("chunks")
        .update({
          embedding: vettore,
          embedding_modello: modello,
          embedded_at: new Date().toISOString(),
        })
        .eq("id", chunk.id)
        .is("embedding", null);

      if (error) {
        errori += 1;
        logError("preventivatore.indicizzazione", "Aggiornamento chunk fallito", error, {
          chunkId: chunk.id,
        });
      } else {
        indicizzati += 1;
      }
    } catch (errore) {
      if (timer) clearTimeout(timer);
      if (errore instanceof Error && errore.message === "timeout_indicizzazione") {
        logWarn("preventivatore.indicizzazione", "Indicizzazione interrotta per timeout", {
          chunkId: chunk.id,
        });
        interrotto = true;
        return;
      }
      errori += 1;
      logError("preventivatore.indicizzazione", "Embedding chunk fallito", errore, {
        chunkId: chunk.id,
      });
    }
  };

  for (let i = 0; i < chunks.length && !interrotto; i += PARALLELI) {
    await Promise.all(chunks.slice(i, i + PARALLELI).map(indicizzaUno));
  }

  return { indicizzati, errori };
}

export async function indicizzaDocumento(
  documentoId: string,
  opts: { timeoutMs?: number } = {}
): Promise<EsitoIndicizzazione> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .schema("preventivatore")
      .from("chunks")
      .select("id, contenuto")
      .eq("documento_id", documentoId)
      .is("embedding", null)
      .order("chunk_index", { ascending: true });

    if (error) {
      logError("preventivatore.indicizzazione", "Lettura chunk documento fallita", error, {
        documentoId,
      });
      return { indicizzati: 0, errori: 1 };
    }
    return await indicizzaChunks(
      (data ?? []) as ChunkDaIndicizzare[],
      opts.timeoutMs ?? TIMEOUT_DEFAULT_MS
    );
  } catch (errore) {
    logError("preventivatore.indicizzazione", "Indicizzazione documento fallita", errore, {
      documentoId,
    });
    return { indicizzati: 0, errori: 1 };
  }
}

export async function indicizzaMancanti(limite: number): Promise<EsitoIndicizzazione> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .schema("preventivatore")
      .from("chunks")
      .select("id, contenuto")
      .is("embedding", null)
      .order("created_at", { ascending: true })
      .limit(Math.max(0, Math.trunc(limite)));

    if (error) {
      logError("preventivatore.indicizzazione", "Lettura chunk mancanti fallita", error);
      return { indicizzati: 0, errori: 1 };
    }
    return await indicizzaChunks((data ?? []) as ChunkDaIndicizzare[], TIMEOUT_DEFAULT_MS);
  } catch (errore) {
    logError("preventivatore.indicizzazione", "Indicizzazione mancanti fallita", errore);
    return { indicizzati: 0, errori: 1 };
  }
}
