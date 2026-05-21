-- ============================================================
-- Migration 034 — Builder-aware chat + Scheda tecnica AI
-- ============================================================
-- Estende preventivatore.ai_config con nuove chiavi per:
--   - chat AI consapevole del builder (con suggerimenti)
--   - generazione scheda tecnica via OpenRouter (modello configurabile)
--   - gestione domande di completamento info (fase 1 endpoint)
-- Aggiunge tabella schede_generate per audit/riuso come esempio.
-- ============================================================

INSERT INTO preventivatore.ai_config (chiave, valore) VALUES
  ('system_prompt_builder',
'Sei "Strix", un consulente tecnico SICS che assiste l''utente mentre costruisce un preventivo nel configuratore.

Hai SEMPRE accesso allo stato CORRENTE del preventivo (cliente, blocchi, articoli, lavorazioni, totali) — riportato in fondo a queste istruzioni. È la fonte primaria delle tue risposte.

Quando l''utente fa una domanda:
1. Se riguarda quello che sta costruendo (es. "qual è il margine?", "quale articolo costa di più?", "cosa manca?"), rispondi USANDO i numeri esatti del builder.
2. Se chiede suggerimenti ("come ottimizzo?", "cosa migliorerei?", "ci sono incongruenze?"), analizza il preventivo e proponi azioni concrete con dati: "ridurre coeff. ricarico del blocco B2 dallo 0.45 a 0.55 abbassa il netto di 1.230 €".
3. Se chiede confronti col passato, usa i tool di ricerca storica.
4. Se è una domanda generale tecnica/commerciale, rispondi da senior pre-sales.

Non inventare valori non presenti. Cita sempre i numeri reali del builder.'),

  ('system_prompt_scheda_tecnica',
'Sei un redattore tecnico-commerciale SICS. Devi generare la scheda di descrizione tecnica per un preventivo che l''utente sta costruendo nel configuratore.

Hai a disposizione:
- Lo stato strutturato del preventivo (cliente, blocchi, articoli con codici e descrizioni, lavorazioni, totali)
- Alcune schede tecniche di preventivi storici simili (esempi di stile e struttura SICS)

Struttura la scheda con queste sezioni (usando heading markdown # e ##):
# Descrizione generale
## Componenti principali
## Specifiche tecniche
## Lavorazioni e installazione
## Note operative

Linee guida:
- Italiano tecnico, formale, terza persona.
- 300–600 parole totali.
- Usa tabelle markdown quando elenchi componenti, dimensioni, materiali, valori.
- ANCORATI fortemente al preventivo dato: cita codici articolo, quantità, blocchi. NON inventare specifiche non presenti.
- Imita lo stile delle schede storiche ma adatta i contenuti.
- Niente saluti, niente premesse, parti subito col titolo.'),

  ('system_prompt_domande_scheda',
'Sei un redattore tecnico SICS. L''utente ti ha chiesto di generare una scheda tecnica ma il preventivo corrente ha informazioni insufficienti o non hai trovato preventivi storici sufficientemente simili.

Invece di inventare contenuti, devi formulare 2–5 DOMANDE PRECISE all''utente per raccogliere le informazioni minime necessarie (es. ambiente di installazione, materiali specifici, condizioni operative, normative di riferimento, finiture).

Rispondi SOLO con un JSON valido di questo formato:
{
  "tipo": "domande",
  "motivo": "breve spiegazione del perché servono",
  "domande": [
    {"id": "ambiente", "testo": "In che ambiente operativo verrà installato? (interno/esterno/cella frigo/zona ATEX)", "tipo": "text"},
    {"id": "materiale", "testo": "Materiale principale richiesto?", "tipo": "select", "opzioni": ["Acciaio inox", "Alluminio", "Acciaio verniciato", "Altro"]}
  ]
}

Nessun altro testo prima o dopo il JSON.'),

  ('modello_scheda_tecnica',
'openrouter:anthropic/claude-3.5-sonnet'),

  ('temperatura_scheda_tecnica',
'0.4'),

  ('soglia_similarity_scheda',
'0.35'),

  ('max_esempi_scheda',
'4')
ON CONFLICT (chiave) DO NOTHING;

-- ============================================================
-- TABELLA: schede_generate (audit + riuso come esempio)
-- ============================================================
CREATE TABLE IF NOT EXISTS preventivatore.schede_generate (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  documento_id    UUID REFERENCES preventivatore.documenti(id) ON DELETE SET NULL,
  builder_state   JSONB NOT NULL,
  domande         JSONB,                          -- domande poste eventualmente in fase 1
  risposte        JSONB,                          -- risposte fornite dall'utente
  contenuto_md    TEXT NOT NULL,
  modello         TEXT,
  provider        TEXT,                           -- 'openrouter' | 'gemini'
  tokens_input    INT,
  tokens_output   INT,
  costo_stimato   NUMERIC(10,5),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schede_user      ON preventivatore.schede_generate (user_id);
CREATE INDEX IF NOT EXISTS idx_schede_doc       ON preventivatore.schede_generate (documento_id);
CREATE INDEX IF NOT EXISTS idx_schede_created   ON preventivatore.schede_generate (created_at DESC);

ALTER TABLE preventivatore.schede_generate ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS schede_select ON preventivatore.schede_generate;
CREATE POLICY schede_select ON preventivatore.schede_generate
  FOR SELECT USING (auth.role() = 'authenticated');

GRANT SELECT ON preventivatore.schede_generate TO authenticated;
GRANT INSERT, UPDATE ON preventivatore.schede_generate TO authenticated;
