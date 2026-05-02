import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Client Supabase con service role key.
 * Usa SOLO in Server Actions / Route Handlers lato server.
 * Non esporre mai al client.
 *
 * Singleton: evita di creare una nuova istanza ad ogni chiamata.
 */
let _adminClient: SupabaseClient | null = null;

export function createAdminClient(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );
  }
  return _adminClient;
}
