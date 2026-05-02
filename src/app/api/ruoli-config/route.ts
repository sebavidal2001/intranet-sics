import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const db = createAdminClient();
  const { data } = await db
    .from("ruoli_config")
    .select("id, nome, slug, colore, ordine")
    .order("ordine");

  return NextResponse.json(data ?? []);
}
