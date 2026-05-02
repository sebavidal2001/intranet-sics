-- ─── Righe distinta materiali strutturate ─────────────────────────────────────
-- Tabella normalizzata per le voci BOM dei preventivi.
-- Viene popolata durante l'ingestion (ingest-scale.mjs) e permette query
-- aggregate su codici, prezzi e quantità senza dover parsare il testo dei chunk.

CREATE TABLE preventivatore.righe_distinta (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id     uuid NOT NULL REFERENCES preventivatore.documenti(id) ON DELETE CASCADE,
  sheet_name       text,
  codice_articolo  text,
  descrizione      text NOT NULL,
  quantita         numeric,
  prezzo_unitario  numeric,   -- costo unitario dalla distinta Excel (col D)
  ricarico_pct     numeric,   -- ricarico % (col E)
  totale_riga      numeric,   -- totale riga calcolato (col F)
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Indici per le query più comuni
CREATE INDEX idx_righe_doc     ON preventivatore.righe_distinta(documento_id);
CREATE INDEX idx_righe_codice  ON preventivatore.righe_distinta(codice_articolo);
CREATE INDEX idx_righe_prezzo  ON preventivatore.righe_distinta(prezzo_unitario DESC NULLS LAST);

-- RLS: solo utenti autenticati possono leggere
ALTER TABLE preventivatore.righe_distinta ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read" ON preventivatore.righe_distinta
  FOR SELECT USING (auth.role() = 'authenticated');
