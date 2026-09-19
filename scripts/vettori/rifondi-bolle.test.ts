/**
 * Porta nel livello operativo tutte le bolle del grezzo, non solo le ultime.
 *
 * `GET /api/portali/vettori/bolle` fonde i **500 documenti piu' recenti** a
 * ogni apertura della pagina: basta e avanza per il lavoro al banco, e ha il
 * pregio di non rileggere lo storico mille volte al giorno. L'effetto
 * collaterale e' che i mesi vecchi non sono mai stati fusi — a settembre 2026
 * il gestionale aveva 33 spedizioni di gennaio contro le 102 dei fogli
 * dell'amministrazione, e non perche' il gestionale non le avesse.
 *
 * Questo script fa lo stesso lavoro su tutto il grezzo, con la stessa funzione
 * (`sincronizzaBolleGestionali`): nessuna regola diversa, nessuna scorciatoia.
 * Le bolle che non viaggiano con un vettore restano fuori, le spedizioni
 * congelate non si toccano, e una spedizione gia' presente con la stessa
 * chiave — comprese quelle importate dai fogli Excel — viene **riusata** e
 * arricchita, non duplicata.
 *
 *   npx vitest run --config scripts/vettori/vitest-rifondi.config.ts
 *
 * Si ferma all'anteprima se non gli si dice di scrivere: VETTORI_RIFONDI=1
 */
import { it, expect } from "vitest";
import { createAdminClient } from "../../src/lib/supabase/admin";
import { sincronizzaBolleGestionali } from "../../src/lib/portali/vettori/bolle";
import type { BollaGestionale } from "../../src/lib/portali/vettori/abbinamento";

process.loadEnvFile(".env.local");

const SCRIVI = process.env.VETTORI_RIFONDI === "1";
const BLOCCO = 500;

const CAMPI =
  "id_documento,codice_profilo,tipo_registro,numero_progressivo,numero_documento," +
  "data_documento,data_registrazione,id_sog_commerciale,codice_soggetto,soggetto," +
  "zona_cap,zona_provincia,fonte_zona,tipo_trasporto_codice,tipo_trasporto,tras_mezzo," +
  "vettore_codice,vettore,num_colli,peso_netto,peso_lordo,volume";

it("rifonde il grezzo nelle spedizioni", async () => {
  const admin = createAdminClient();
  const conta = async () => {
    const { count, error } = await admin
      .schema("vettori")
      .from("spedizioni")
      .select("id", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    return count ?? 0;
  };

  const prima = await conta();
  console.log(`spedizioni prima: ${prima}${SCRIVI ? "" : " — anteprima, non scrive"}`);

  let da = 0;
  let letti = 0;
  for (;;) {
    const { data, error } = await admin
      .schema("bi")
      .from("trasporti_documenti")
      .select(CAMPI)
      // In ordine di data crescente: le bolle vecchie per prime, cosi' se il
      // caricamento si interrompe si sa fin dove e' arrivato.
      .order("data_documento", { ascending: true, nullsFirst: true })
      .order("id_documento", { ascending: true })
      .range(da, da + BLOCCO - 1);
    if (error) throw new Error(error.message);
    const bolle = (data ?? []) as unknown as BollaGestionale[];
    if (bolle.length === 0) break;
    letti += bolle.length;
    if (SCRIVI) await sincronizzaBolleGestionali(bolle);
    console.log(`  ${letti} documenti letti${SCRIVI ? " e fusi" : ""}`);
    if (bolle.length < BLOCCO) break;
    da += BLOCCO;
  }

  const dopo = await conta();
  console.log(`documenti nel grezzo: ${letti}`);
  console.log(`spedizioni dopo: ${dopo} (${dopo - prima > 0 ? "+" : ""}${dopo - prima})`);
  expect(letti).toBeGreaterThan(0);
}, 3_600_000);
