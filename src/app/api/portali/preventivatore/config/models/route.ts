import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPortaleAccesso, hasMinLivello } from "@/lib/auth/portale";

export const dynamic = "force-dynamic";

type OpenRouterModel = {
  id: string;
  name: string;
  description?: string;
  context_length?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
  supported_parameters?: string[];
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
};

type ModelOption = {
  id: string;
  name: string;
  context_length: number | null;
  input_cost_per_million: number | null;
  output_cost_per_million: number | null;
  tags: string[];
  description: string;
};

function pricePerMillion(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed * 1_000_000 : null;
}

function buildTags(model: OpenRouterModel): string[] {
  const text = `${model.id} ${model.name} ${model.description ?? ""}`.toLowerCase();
  const tags: string[] = [];

  if (text.includes("claude") || text.includes("sonnet")) tags.push("rag affidabile");
  if (text.includes("haiku") || text.includes("flash") || text.includes("mini")) tags.push("veloce");
  if (text.includes("gpt-4.1") || text.includes("sonnet") || text.includes("pro")) tags.push("ragionato");
  if (text.includes("coder") || text.includes("code")) tags.push("codice");
  if (text.includes("deepseek") || text.includes("qwen") || text.includes("mistral")) tags.push("economico");
  if (model.context_length && model.context_length >= 200_000) tags.push("contesto lungo");
  if (model.architecture?.input_modalities?.includes("image")) tags.push("multimodale");
  if (tags.length === 0) tags.push("generale");

  return [...new Set(tags)].slice(0, 3);
}

function shortDescription(description: string | undefined): string {
  if (!description) return "Modello OpenRouter compatibile con tool calling.";
  const firstSentence = description.split(/(?<=[.!?])\s+/)[0] ?? description;
  return firstSentence.length > 170 ? `${firstSentence.slice(0, 167)}...` : firstSentence;
}

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    }

    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (!hasMinLivello(livello, "admin")) {
      return NextResponse.json({ error: "Accesso negato" }, { status: 403 });
    }

    const res = await fetch("https://openrouter.ai/api/v1/models?supported_parameters=tools", {
      headers: { Accept: "application/json" },
      next: { revalidate: 60 * 60 },
    });

    if (!res.ok) {
      return NextResponse.json({ error: `OpenRouter HTTP ${res.status}` }, { status: 502 });
    }

    const payload = (await res.json()) as { data?: OpenRouterModel[] };
    const models: ModelOption[] = (payload.data ?? [])
      .filter((model) => model.supported_parameters?.includes("tools"))
      .filter((model) => {
        const outputs = model.architecture?.output_modalities;
        return !outputs || outputs.includes("text");
      })
      .map((model) => ({
        id: model.id,
        name: model.name,
        context_length: model.context_length ?? null,
        input_cost_per_million: pricePerMillion(model.pricing?.prompt),
        output_cost_per_million: pricePerMillion(model.pricing?.completion),
        tags: buildTags(model),
        description: shortDescription(model.description),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "it", { sensitivity: "base" }));

    return NextResponse.json({ models, source: "openrouter" });
  } catch (error) {
    console.error("OpenRouter models fetch error:", error);
    return NextResponse.json({ error: "Errore recupero modelli OpenRouter" }, { status: 500 });
  }
}
