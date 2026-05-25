#!/usr/bin/env node
/**
 * One-off: assegna documenti.cliente_master_id ai preventivi storici S/C
 * basandosi sul mapping deciso (vedi sessione conversazione clienti_master).
 *
 * Sicuro da rieseguire: aggiorna solo dove cliente_master_id IS NULL.
 * Per i casi con `note_doc`: appende la nota a documenti.note (idempotente).
 *
 * Uso: node scripts/map-storici-cliente-master.cjs [--dry-run]
 */

const fs = require("fs");
const path = require("path");

function loadEnvLocal() {
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
}
loadEnvLocal();

const { createClient } = require("@supabase/supabase-js");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const DRY = process.argv.includes("--dry-run");

// Lookup target: { dest_id } prevale su { ragione_hq } (HQ pura, dest=ragione)
// Una entry per ogni stringa distinta presente in documenti.cliente.
const MAP = [
  // ── A. Non trovati nel Cruscotto → placeholder provvisori ──
  { db: "S.A.M.",         codice: "PROV-001",  dest_id: "PROV-1" },
  { db: "STUDIO ENTER",   codice: "PROV-002",  dest_id: "PROV-2" },
  { db: "PROSGM",         codice: "PROV-003",  dest_id: "PROV-3" },
  { db: "RAYTEC",         dest_id: "2701" },                       // RAYTEC VISION spa HQ

  // ── A. Risposte utente per i restanti "miss" ──
  { db: "BEUTYGE",        dest_id: "10876" },                       // BEAUTYGE ITALY spa
  { db: "HUBER-BIOLCHIM", dest_id: "8221"  },                       // BIOLCHIM spa
  { db: "SAUER DANFOSS",  dest_id: "7550"  },                       // DANFOSS POWER SOLUTIONS
  { db: "SGE",            dest_id: "1644"  },                       // S.G.E. srl
  { db: "SPECIAL VIDEO",  dest_id: "11096" },                       // SPECIALVIDEO srl

  // ── B. IMA — destinazioni canoniche scelte ──
  { db: "IMA",            dest_id: "390"   },                       // IMA spa HQ
  { db: "IMA R.I.",       dest_id: "2203"  },                       // IMA Revisioni Industriali srl
  { db: "IMA RI",         dest_id: "2203"  },
  { db: "IMA SAFE",       dest_id: "2340"  },                       // IMA spa-div.SAFE
  { db: "IMA-SAFE",       dest_id: "2340"  },
  { db: "IMA LIFE",       dest_id: "2143"  },                       // IMA spa-div. LIFE
  { db: "IMA-LIFE",       dest_id: "2143"  },
  { db: "IMA BFB",        dest_id: "1760"  },                       // IMA spa-div.BFB Division
  { db: "IMA-BFB",        dest_id: "1760"  },
  { db: "IMA div.BFB",    dest_id: "1760"  },
  { db: "IMA GIMA",       dest_id: "2712"  },                       // IMA spa-B.U IMA (DIV.2900-GIMA)
  { db: "IMA-GIMA",       dest_id: "2712"  },
  { db: "GIMA",           dest_id: "2712"  },                       // (alias IMA GIMA)

  // ── B. WALVOIL ──
  { db: "WALVOIL",             dest_id: "4087" },                   // WALVOIL spa HQ (più recente)
  { db: "WALVOIL BIBBIANO",    dest_id: "2832" },
  { db: "WALVOIL CORTE TEGGE", dest_id: "2970" },

  // ── C1. Match parziali confermati ──
  { db: "ALLESTIMENTI E PUBBLICITA'", dest_id: "10691" },
  { db: "B.BRAUN",             dest_id: "5722" },
  { db: "BEAUTYGE",            dest_id: "10876" },
  { db: "CLEVERTECH",          dest_id: "1894" },
  { db: "ELETTROTECNICA IMOLESE", dest_id: "6122" },
  { db: "EMMECI ELETTRONICA",  dest_id: "9186" },
  { db: "INTERPUMP HYDRAULICS",dest_id: "6372" },
  { db: "IRONS TECHNOLOGY",    dest_id: "7912" },
  { db: "KATME",               dest_id: "10862" },
  { db: "MAC SHOES",           dest_id: "2075" },
  { db: "MARCHESINI",          dest_id: "581"  },
  { db: "UCT",                 dest_id: "11238" },
  { db: "V2 ENRINEERING",      dest_id: "4078" },                   // refuso → V2 ENGINEERING
  { db: "FASTER CSPT",         dest_id: "10216" },
  { db: "CM3",                 dest_id: "4988" },

  // ── C2. Ambigui risolti ──
  { db: "CURTI",        dest_id: "49"   },                          // CURTI spa COSTRUZIONI MECCANICHE HQ
  { db: "EUROCOOLING",  dest_id: "8140" },                          // EURO COOLING SYSTEM srl
  { db: "SYRTEC",       dest_id: "5894" },                          // SYRTEC SERVICE srl

  // ── C3. Risposte utente ──
  { db: "AUTOMA",       dest_id: "9958" },                          // AUTOMA BY MAGIC srl
  { db: "BIO SYNTEX",   dest_id: "9763" },                          // BIOSYNTEX srl
  { db: "CMI",          dest_id: "5195" },                          // C.M.I. srl a socio unico
  { db: "FAMARTEC",     dest_id: "9240" },                          // FAMAR TEC srl
  { db: "MAIOR",        dest_id: "10678", note_doc: "div. MAIOR" }, // EUROTECNO srl
  { db: "MCE",          dest_id: "10955" },                         // M.C.E. srl
  { db: "N.S. SISTEMI", dest_id: "8630" },                          // N.S. SISTEMI & SERVIZI srl
  { db: "POLIFILM",     dest_id: "9776" },                          // POLIFILM ITALIA srl
  { db: "STUDIO TECNICO NPM", dest_id: "3998" },                    // STUDIO TECNICO N.P.M. srl P@
  { db: "TMC",          dest_id: "4008" },                          // T.M.C. spa

  // ── D. Descrizione infilata nel cliente → ragione pulita + note ──
  { db: "ERRELLE - KANBAN 1200x1200",                                  dest_id: "6548", note_doc: "Kanban 1200x1200" },
  { db: "ERRELLE(MODIFICA KANBAN ESISTENTI + REALIZZAZIONE NUOVI)",    dest_id: "6548", note_doc: "Modifica Kanban esistenti + realizzazione nuovi" },
  { db: "MONTENEGRO div. CANNAMELA",   dest_id: "3082" },           // MONTENEGRO srl-div. CANNAMELA
  { db: "MONTENEGRO-CANNAMELA",        dest_id: "3082" },
  { db: "SALVATORI &  CASADIO",        dest_id: "10197" },          // LEONI & CASADIO snc
  { db: "SALVATORI E CASADIO",         dest_id: "10197" },

  // ── E. Match esatti ragione = destinazione (HQ pura del cliente) ──
  // Lookup via codice_cliente, prendendo la dest dove ragione_sociale = destinazione (HQ)
  { db: "3F FILIPPI",                         hq_ragione_like: "3F FILIPPI" },
  { db: "3U VISION",                          hq_ragione_like: "3U VISION srl" },
  { db: "AIRONE AMBIENTE",                    hq_ragione_like: "AIRONE AMBIENTE srl" },
  { db: "ALPHAMAC",                           hq_ragione_like: "ALPHAMAC srl" },
  { db: "ANDALO' GIANNI",                     hq_ragione_like: "ANDALO' GIANNI srl" },
  { db: "ATLANTA",                            hq_ragione_like: "ATLANTA spa" },
  { db: "BIOCHIMICA",                         hq_ragione_like: "BIOCHIMICA spa" },
  { db: "BIOLCHIM",                           hq_ragione_like: "BIOLCHIM spa" },
  { db: "BM",                                 hq_ragione_like: "BM srl" },
  { db: "BM SYNTHESIS",                       hq_ragione_like: "BM SYNTHESIS srl" },
  { db: "CABLOTECH",                          hq_ragione_like: "CABLOTECH srl" },
  { db: "CAVICCHI IMPIANTI",                  hq_ragione_like: "CAVICCHI IMPIANTI srl" },
  { db: "CENACCHI INTERNATIONAL",             hq_ragione_like: "CENACCHI INTERNATIONAL srl" },
  { db: "CLECA",                              hq_ragione_like: "CLECA spa" },
  { db: "CNIKA",                              hq_ragione_like: "CNIKA" },
  { db: "COMECER",                            hq_ragione_like: "COMECER spa" },
  { db: "CPS",                                hq_ragione_like: "CPS COMPANY srl" },
  { db: "DENKEN ITALIA",                      hq_ragione_like: "DENKEN ITALIA srl" },
  { db: "DI QUATTRO",                         hq_ragione_like: "DI QUATTRO srl" },
  { db: "ERRELLE",                            hq_ragione_like: "ERRELLE srl" },
  { db: "EUREK",                              hq_ragione_like: "EUREK srl" },
  { db: "FASTER",                             hq_ragione_like: "FASTER srl" },
  { db: "FOMIR",                              hq_ragione_like: "FOMIR srl" },
  { db: "GEMA ELETTROMECCANICA",              hq_ragione_like: "GEMA ELETTROMECCANICA srl" },
  { db: "GM3",                                hq_ragione_like: "GM3 srl" },
  { db: "GUALANDI",                           hq_ragione_like: "GUALANDI srl" },
  { db: "ICA",                                hq_ragione_like: "ICA spa" },
  { db: "KIMATIC",                            hq_ragione_like: "KIMATIC srl" },
  { db: "L.A.D.A.",                           hq_ragione_like: "L.A.D.A. snc" },
  { db: "LESEPIDADO",                         hq_ragione_like: "LESEPIDADO srl" },
  { db: "MATTEUZZI",                          hq_ragione_like: "MATTEUZZI srl" },
  { db: "MECCANICA R.C.",                     hq_ragione_like: "MECCANICA R.C. srl" },
  { db: "MECCANICA ROSSI",                    hq_ragione_like: "MECCANICA ROSSI srl" },
  { db: "MESPIC",                             hq_ragione_like: "MESPIC srl" },
  { db: "MG2",                                hq_ragione_like: "MG2 srl" },
  { db: "MONTENEGRO",                         hq_ragione_like: "MONTENEGRO srl" },
  { db: "NIMAX",                              hq_ragione_like: "NIMAX spa" },
  { db: "NORBLAST",                           hq_ragione_like: "NORBLAST srl" },
  { db: "PHOENIX MECANO",                     hq_ragione_like: "PHOENIX MECANO srl" },
  { db: "QUICK LOAD",                         hq_ragione_like: "QUICK LOAD srl" },
  { db: "RESTA",                              hq_ragione_like: "RESTA srl" },
  { db: "RICREATEC",                          hq_ragione_like: "RICREATEC srl" },
  { db: "SACMI IMOLA",                        hq_ragione_like: "SACMI IMOLA sc" },
  { db: "SACMI",                              hq_ragione_like: "SACMI IMOLA sc" },
  { db: "SER.MAC",                            hq_ragione_like: "SER.MAC srl" },
  { db: "SER.MAC.",                           hq_ragione_like: "SER.MAC srl" },
  { db: "SERIOMAC",                           hq_ragione_like: "SERIOMAC srl" },
  { db: "SIMIC",                              hq_ragione_like: "SIMIC spa" },
  { db: "SIMONI",                             hq_ragione_like: "SIMONI srl" },
  { db: "SIMOPARMA",                          hq_ragione_like: "SIMOPARMA" },
  { db: "SKAN-X",                             hq_ragione_like: "SKAN" },
  { db: "SOIMOD",                             hq_ragione_like: "SOIMOD spa" },
  { db: "SORMA",                              hq_ragione_like: "SORMA spa" },
  { db: "SYRTEC SERVICE",                     hq_ragione_like: "SYRTEC SERVICE srl" },
  { db: "TECNA",                              hq_ragione_like: "TECNA spa" },
  { db: "TECNO-ONE",                          hq_ragione_like: "TECNO-ONE srl" },
  { db: "TOPPY",                              hq_ragione_like: "TOPPY srl" },
  { db: "UPB",                                hq_ragione_like: "UPB srl" },
  { db: "V2 ENGINEERING",                     hq_ragione_like: "V2 ENGINEERING srl" },
  { db: "VIARA",                              hq_ragione_like: "VIARA srl" },
  { db: "WATER ENERGY",                       hq_ragione_like: "WATER ENERGY srl" },
  // Cliente "BIO SYNTEX" già sopra in C3; aggiungiamo SIMOPARMA generico
  // Casi C.I.A.P. HONDA e CONSULENZE TECNICHE INDUSTRIALI: erano "match solo per destinazione"
  // generici — proviamo a mappare alle ragioni master:
  { db: "C.I.A.P. HONDA",                     hq_ragione_like: "T.C.B." },                    // dest "HONDA ITALIA" sotto T.C.B.
  { db: "CONSULENZE TECNICHE INDUSTRIALI",    hq_ragione_like: "CRAM srl" },                   // dest "CARBONCHI..." sotto CRAM
];

async function resolveTargetId(entry) {
  let q = db.schema("preventivatore").from("clienti_master").select("id, ragione_sociale, destinazione, id_destinazione");
  if (entry.dest_id) {
    q = q.eq("id_destinazione", entry.dest_id);
    if (entry.codice) q = q.eq("codice_cliente", entry.codice);
  } else if (entry.hq_codice) {
    // HQ del codice: ragione = destinazione, prima per id_destinazione numerico
    q = q.eq("codice_cliente", entry.hq_codice);
  } else if (entry.hq_ragione_like) {
    q = q.ilike("ragione_sociale", `${entry.hq_ragione_like}%`);
  } else {
    return null;
  }
  const { data, error } = await q;
  if (error) {
    console.error(`  ERR lookup ${entry.db}:`, error.message);
    return null;
  }
  if (!data || data.length === 0) return null;

  // Preferenza: HQ pura (ragione_sociale.trim() == destinazione.trim()), poi id_destinazione minore (int)
  const sorted = [...data].sort((a, b) => {
    const aHq = (a.ragione_sociale ?? "").trim() === (a.destinazione ?? "").trim() ? 0 : 1;
    const bHq = (b.ragione_sociale ?? "").trim() === (b.destinazione ?? "").trim() ? 0 : 1;
    if (aHq !== bHq) return aHq - bHq;
    const ai = parseInt(a.id_destinazione, 10);
    const bi = parseInt(b.id_destinazione, 10);
    if (Number.isFinite(ai) && Number.isFinite(bi)) return ai - bi;
    return 0;
  });
  return sorted[0];
}

(async () => {
  console.log(`[${new Date().toISOString()}] Mapping retroattivo clienti storici (${DRY ? "DRY" : "APPLY"})`);
  let ok = 0;
  let missing = 0;
  let updated = 0;
  const failed = [];

  for (const entry of MAP) {
    const target = await resolveTargetId(entry);
    if (!target) {
      failed.push(entry.db);
      missing++;
      console.log(`  ❌ ${entry.db.padEnd(60)} → target NON TROVATO`);
      continue;
    }
    ok++;
    const tag = `[${target.id_destinazione}] ${target.ragione_sociale}${target.destinazione && target.destinazione !== target.ragione_sociale ? " | " + target.destinazione : ""}`;
    if (DRY) {
      console.log(`  → ${entry.db.padEnd(60)} → ${tag}`);
      continue;
    }
    // Update documenti.cliente_master_id dove ancora NULL
    const updates = { cliente_master_id: target.id };
    const { data: docsToUpdate, error: selErr } = await db
      .schema("preventivatore")
      .from("documenti")
      .select("id, note")
      .eq("cliente", entry.db)
      .is("cliente_master_id", null);
    if (selErr) {
      console.error(`  ERR select ${entry.db}:`, selErr.message);
      continue;
    }
    if (!docsToUpdate || docsToUpdate.length === 0) {
      console.log(`  · ${entry.db.padEnd(60)} → ${tag} (0 doc da aggiornare)`);
      continue;
    }
    // Applica nota_doc solo se non già contenuta
    for (const doc of docsToUpdate) {
      const upd = { cliente_master_id: target.id };
      if (entry.note_doc) {
        const cur = doc.note ?? "";
        if (!cur.includes(entry.note_doc)) {
          upd.note = cur ? `${cur}\n${entry.note_doc}` : entry.note_doc;
        }
      }
      const { error: updErr } = await db
        .schema("preventivatore")
        .from("documenti")
        .update(upd)
        .eq("id", doc.id);
      if (updErr) {
        console.error(`    ERR update doc ${doc.id}:`, updErr.message);
        continue;
      }
      updated++;
    }
    console.log(`  ✓ ${entry.db.padEnd(60)} → ${tag}  (${docsToUpdate.length} doc)`);
  }

  console.log(`\nMapping risolti: ${ok}/${MAP.length}   |   target mancanti: ${missing}   |   documenti aggiornati: ${updated}`);
  if (failed.length > 0) {
    console.log("Non risolti:", failed.join(", "));
  }
})().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
