/**
 * Logger strutturato minimale (JSON-line) per le API route.
 *
 * Obiettivo: avere log machine-parsable con `scope`, `requestId` e `meta`
 * invece di `console.error("X error:", err)` sparsi e non correlabili.
 *
 * Uso tipico in una route handler:
 * ```ts
 * const reqId = newRequestId();
 * try { ... }
 * catch (e) { logError("preventivatore.documenti", "lista fallita", e, { reqId }); }
 * ```
 *
 * Volutamente zero dipendenze: in produzione (PM2) i log finiscono su stdout
 * e sono già raccolti da `pm2 logs`. Una riga = un evento JSON.
 */

type Level = "error" | "warn" | "info";

interface LogMeta {
  /** Request id per correlare più log della stessa richiesta. */
  reqId?: string;
  [key: string]: unknown;
}

/** Serializza un Error (o valore qualsiasi) in qualcosa di JSON-friendly. */
function serializeError(err: unknown): unknown {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return err;
}

function emit(level: Level, scope: string, message: string, error?: unknown, meta?: LogMeta) {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    scope,
    message,
  };
  if (error !== undefined) entry.error = serializeError(error);
  if (meta && Object.keys(meta).length > 0) entry.meta = meta;

  const line = JSON.stringify(entry);
  // eslint-disable-next-line no-console
  if (level === "error") console.error(line);
  // eslint-disable-next-line no-console
  else if (level === "warn") console.warn(line);
  // eslint-disable-next-line no-console
  else console.log(line);
}

export function logError(scope: string, message: string, error?: unknown, meta?: LogMeta): void {
  emit("error", scope, message, error, meta);
}

export function logWarn(scope: string, message: string, meta?: LogMeta): void {
  emit("warn", scope, message, undefined, meta);
}

export function logInfo(scope: string, message: string, meta?: LogMeta): void {
  emit("info", scope, message, undefined, meta);
}

/** Id breve (8 char) per correlare i log di una singola richiesta. */
export function newRequestId(): string {
  // crypto.randomUUID è disponibile in Node 18+ e nel runtime edge di Next.
  return globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10);
}
