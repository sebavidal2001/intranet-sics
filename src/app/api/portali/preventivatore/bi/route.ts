import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";
import { DEFAULT_BI_DASHBOARD } from "@/lib/portali/preventivatore/bi/defaults";
import type { BiDashboardConfig, BiDashboardRow, BiScope } from "@/lib/portali/preventivatore/bi/types";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

function isScope(value: string | null): value is BiScope {
  return value === "user" || value === "team";
}

function sanitizeConfig(input: unknown): BiDashboardConfig {
  const cfg = input as Partial<BiDashboardConfig>;
  if (!cfg || cfg.version !== 1 || !Array.isArray(cfg.widgets)) return DEFAULT_BI_DASHBOARD;
  return {
    version: 1,
    filters: Array.isArray(cfg.filters) ? cfg.filters : [],
    widgets: cfg.widgets,
  } as BiDashboardConfig;
}

async function ensureDashboard(scope: BiScope, userId: string): Promise<BiDashboardRow> {
  const admin = createAdminClient().schema("preventivatore");

  let query = admin
    .from("bi_dashboards")
    .select("id, scope, user_id, title, config, updated_at")
    .eq("scope", scope);
  query = scope === "user" ? query.eq("user_id", userId) : query.is("user_id", null);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (data) return data as BiDashboardRow;

  const { data: inserted, error: insertError } = await admin
    .from("bi_dashboards")
    .insert({
      scope,
      user_id: scope === "user" ? userId : null,
      title: scope === "team" ? "Dashboard Team" : "La mia dashboard",
      config: DEFAULT_BI_DASHBOARD,
    })
    .select("id, scope, user_id, title, config, updated_at")
    .single();
  if (insertError) throw insertError;
  return inserted as BiDashboardRow;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (livello === null) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });

    const scopeParam = new URL(request.url).searchParams.get("scope");
    const scope = isScope(scopeParam) ? scopeParam : "user";
    const dashboard = await ensureDashboard(scope, user.id);

    return NextResponse.json({ dashboard });
  } catch (error) {
    logError("preventivatore.bi", "BI dashboard GET error", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}

// Livelli con permesso di scrivere la dashboard team (in ordine di privilegio).
// Definito come Set per check rapido.
const TEAM_WRITE_LEVELS = new Set(["admin", "superadmin", "exporter"]);

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (livello === null) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });

    const body = await request.json() as { scope?: BiScope; title?: string; config?: unknown };
    const scope = isScope(body.scope ?? null) ? body.scope! : "user";

    // ─── Security check: scope=team richiede livello admin/exporter ──────────
    if (scope === "team" && !TEAM_WRITE_LEVELS.has(livello)) {
      return NextResponse.json(
        { error: "Non hai i permessi per modificare la dashboard del team. Serve livello admin o exporter." },
        { status: 403 }
      );
    }

    const current = await ensureDashboard(scope, user.id);
    const config = sanitizeConfig(body.config);

    const adminClient = createAdminClient();
    const { data, error } = await adminClient
      .schema("preventivatore")
      .from("bi_dashboards")
      .update({
        title: body.title?.trim() || current.title,
        config,
      })
      .eq("id", current.id)
      .select("id, scope, user_id, title, config, updated_at")
      .single();

    if (error) throw error;

    // ─── Audit log: chi ha modificato cosa e quando ──────────────────────────
    // Tabella creata in migrazione 028 (bi_dashboard_log).
    void adminClient
      .schema("preventivatore")
      .from("bi_dashboard_log")
      .insert({
        dashboard_id: current.id,
        scope,
        user_id: user.id,
        action: "update",
        title: data.title,
        n_widgets: Array.isArray(config.widgets) ? config.widgets.length : 0,
      })
      .then(({ error: logErr }) => {
        if (logErr && logErr.code !== "42P01") logError("preventivatore.bi", "bi_dashboard_log error", logErr);
      });

    return NextResponse.json({ dashboard: data });
  } catch (error) {
    logError("preventivatore.bi", "BI dashboard PUT error", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
