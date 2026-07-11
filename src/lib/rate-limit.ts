/**
 * Rate limiter in-memory a finestra scorrevole (sliding window).
 *
 * Pensato per il deploy attuale: singola VM con PM2 + `next start` (un solo
 * processo Node). Lo stato vive nella memoria del processo — sufficiente per
 * questa topologia. Se in futuro si scala a più istanze/replicas, sostituire
 * il backend con Redis/Upstash mantenendo la stessa firma `checkRateLimit`.
 *
 * Uso tipico in una route handler:
 *   const rl = checkRateLimit(`chiave:${user.id}`, { limit: 20, windowMs: 60_000 });
 *   if (!rl.ok) return tooManyRequests(rl.retryAfterSec);
 */

type Hit = { count: number; resetAt: number };

const buckets = new Map<string, Hit>();

// Pulizia periodica delle chiavi scadute per evitare crescita illimitata.
let lastSweep = 0;
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, hit] of buckets) {
    if (hit.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitOptions {
  /** Numero massimo di richieste consentite nella finestra. */
  limit: number;
  /** Ampiezza della finestra in millisecondi. */
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

export function checkRateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const hit = buckets.get(key);
  if (!hit || hit.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return { ok: true, remaining: opts.limit - 1, retryAfterSec: 0 };
  }

  if (hit.count >= opts.limit) {
    return { ok: false, remaining: 0, retryAfterSec: Math.ceil((hit.resetAt - now) / 1000) };
  }

  hit.count += 1;
  return { ok: true, remaining: opts.limit - hit.count, retryAfterSec: 0 };
}

/**
 * Estrae un identificatore client dagli header (IP). Dietro il reverse proxy
 * della VM si usa X-Forwarded-For; fallback su X-Real-IP. Solo per rate
 * limiting (best-effort), non per decisioni di sicurezza forti.
 */
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

/** Risposta 429 standard con header Retry-After. */
export function tooManyRequests(retryAfterSec: number): Response {
  return new Response(
    JSON.stringify({ error: "Troppe richieste. Riprova tra poco." }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(Math.max(1, retryAfterSec)),
      },
    }
  );
}
