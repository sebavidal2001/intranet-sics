#!/usr/bin/env node
/**
 * Migrazione dominio email: @sics.interno → @s-ics.com (2026-05-26).
 *
 * Operazioni:
 *  1. Elimina lo zombie p.pasquali@sics.interno (id senza profilo public.utenti,
 *     conflitto con il record vero p.pasquali@s-ics.com).
 *  2. Per 9 utenti normali: cambia email auth.users + email public.utenti,
 *     resetta password a "Dipendente123", forza primo_accesso=true.
 *  3. Per 3 utenti esclusi (s.vidal, s.varas, superadmin): cambia SOLO l'email
 *     (auth + public), NESSUN reset password, NESSUN cambio primo_accesso.
 *
 * Idempotente: chi è già stato migrato (auth.users.email ILIKE '%@s-ics.com')
 * viene saltato.
 *
 * Uso:
 *   node scripts/migrate-domain-legacy.cjs --dry-run
 *   node scripts/migrate-domain-legacy.cjs --commit
 */

const fs = require("fs");
const path = require("path");

(function loadEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})();

const { createClient } = require("@supabase/supabase-js");
const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const DRY = !COMMIT;

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("Mancano NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const db = createClient(URL, KEY, { auth: { persistSession: false } });

// Username degli utenti da ESCLUDERE dal reset password (ma email comunque migrata)
const ESCLUSI_RESET = new Set(["s.vidal", "s.varas", "superadmin"]);
const NUOVA_PASSWORD = "Dipendente123";
const ZOMBIE_ID = "1b1dd7c0-020f-44a5-906c-ee5746a4b1bb"; // p.pasquali@sics.interno orfano

(async () => {
  console.log(`[${new Date().toISOString()}] Migrazione dominio email (${DRY ? "DRY-RUN" : "COMMIT"})`);

  // 1) Eliminazione zombie p.pasquali@sics.interno
  const { data: zombieUser } = await db.auth.admin.getUserById(ZOMBIE_ID);
  if (zombieUser?.user) {
    console.log(`\nZombie da eliminare: ${zombieUser.user.email} (id=${ZOMBIE_ID})`);
    if (COMMIT) {
      const { error } = await db.auth.admin.deleteUser(ZOMBIE_ID);
      if (error) console.error(`  ERR delete zombie: ${error.message}`);
      else console.log("  ✓ Zombie eliminato");
    }
  } else {
    console.log(`\nZombie già eliminato in precedenza, skip.`);
  }

  // 2) Lista utenti @sics.interno
  const { data: legacy, error: lErr } = await db
    .from("utenti")
    .select("id, username, email, nome, cognome, ruolo")
    .ilike("email", "%@sics.interno")
    .order("username");
  if (lErr) { console.error(lErr); process.exit(1); }

  console.log(`\nUtenti @sics.interno trovati: ${legacy?.length ?? 0}`);

  let migrati = 0;
  let migratiSoloEmail = 0;
  let errori = 0;

  for (const u of legacy ?? []) {
    const isEscluso = ESCLUSI_RESET.has(u.username ?? "");
    const nuovaEmail = u.email.replace(/@sics\.interno$/i, "@s-ics.com");

    console.log(`\n${u.username} (${u.nome} ${u.cognome}) → ${nuovaEmail}${isEscluso ? "  [EMAIL ONLY — no reset password]" : ""}`);

    if (DRY) {
      if (isEscluso) migratiSoloEmail++; else migrati++;
      continue;
    }

    // 2a) Cambia email + (opzionale) password via Admin API
    const updPayload = isEscluso
      ? { email: nuovaEmail, email_confirm: true }
      : { email: nuovaEmail, email_confirm: true, password: NUOVA_PASSWORD };

    const { error: authErr } = await db.auth.admin.updateUserById(u.id, updPayload);
    if (authErr) {
      console.error(`  ERR auth.admin.updateUserById: ${authErr.message}`);
      errori++;
      continue;
    }

    // 2b) Cambia email su public.utenti + primo_accesso (solo per non esclusi)
    const utenteUpd = isEscluso
      ? { email: nuovaEmail, updated_at: new Date().toISOString() }
      : { email: nuovaEmail, primo_accesso: true, updated_at: new Date().toISOString() };

    const { error: pubErr } = await db.from("utenti").update(utenteUpd).eq("id", u.id);
    if (pubErr) {
      console.error(`  ERR update public.utenti: ${pubErr.message}`);
      errori++;
      continue;
    }

    console.log(`  ✓ ${isEscluso ? "email aggiornata (no password reset)" : "email + password='" + NUOVA_PASSWORD + "' + primo_accesso=true"}`);
    if (isEscluso) migratiSoloEmail++; else migrati++;
  }

  console.log(`\n=== Risultato ===`);
  console.log(`  Migrati con reset password:    ${migrati}`);
  console.log(`  Migrati solo email (esclusi):  ${migratiSoloEmail}`);
  console.log(`  Errori:                        ${errori}`);
  console.log(`  Esclusi (no reset):            ${[...ESCLUSI_RESET].join(", ")}`);
  console.log(`  Password assegnata:            ${NUOVA_PASSWORD}`);
  if (DRY) console.log(`\n  ⚠ DRY-RUN — nessuna scrittura. Rilancia con --commit per applicare.`);
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
