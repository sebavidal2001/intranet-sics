import { createAdminClient } from "@/lib/supabase/admin";

// ─── AI config cache (persists across requests in same Node.js process) ───────

let _cfgCache: { data: Record<string, string>; ts: number } | null = null;
const CFG_TTL_MS = 5 * 60 * 1000;

export async function loadAiConfig(): Promise<Record<string, string>> {
  if (_cfgCache && Date.now() - _cfgCache.ts < CFG_TTL_MS) return _cfgCache.data;
  const admin = createAdminClient();
  const { data } = await admin.schema("preventivatore").from("ai_config").select("chiave, valore");
  const cfg: Record<string, string> = {};
  for (const row of (data ?? []) as Array<{ chiave: string; valore: string }>) cfg[row.chiave] = row.valore;
  _cfgCache = { data: cfg, ts: Date.now() };
  return cfg;
}
