-- Migration 048: motore template prodotti configurabili.
-- Un template = una tipologia di prodotto (es. Scale & Ballatoi) con:
--   * parametri di input (compaiono nel builder)
--   * righe materiale con quantità da FORMULA (slug dei parametri/righe) o manuale
--   * righe manodopera con tempo da formula o input, modalità per_pezzo/una_tantum
--   * costanti del modello costo (imballaggio/tempi/spese/margine/consegna)

CREATE TABLE IF NOT EXISTS preventivatore.template (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome                    text NOT NULL,
  slug                    text NOT NULL UNIQUE,
  descrizione             text,
  attivo                  boolean NOT NULL DEFAULT true,
  ordine                  integer NOT NULL DEFAULT 999,
  consegna_settimane_min  smallint,
  consegna_settimane_max  smallint,
  imballaggio_pct         numeric(6,3) NOT NULL DEFAULT 1,
  tempi_accessori_pct     numeric(6,3) NOT NULL DEFAULT 2.8,
  spese_generali_pct      numeric(6,3) NOT NULL DEFAULT 24.2,
  margine_default_pct     numeric(6,3) NOT NULL DEFAULT 5,
  ricarico_materiale_default numeric(6,3) NOT NULL DEFAULT 0.5,
  ricarico_manodopera_default numeric(6,3) NOT NULL DEFAULT 0.7,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- tipo: number | select | bool
CREATE TABLE IF NOT EXISTS preventivatore.template_parametri (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id   uuid NOT NULL REFERENCES preventivatore.template(id) ON DELETE CASCADE,
  slug          text NOT NULL,      -- usato nelle formule (es. "larghezza")
  label         text NOT NULL,
  tipo          text NOT NULL DEFAULT 'number' CHECK (tipo IN ('number','select','bool')),
  unita         text,               -- es. "mm"
  valore_default text,
  opzioni       jsonb,              -- per tipo select: ["A","B",...]
  ordine        integer NOT NULL DEFAULT 0,
  UNIQUE (template_id, slug)
);

CREATE TABLE IF NOT EXISTS preventivatore.template_righe_materiale (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id     uuid NOT NULL REFERENCES preventivatore.template(id) ON DELETE CASCADE,
  slug            text,             -- opzionale: per referenziare la qty in altre formule
  descrizione     text NOT NULL,
  codice_articolo text,             -- se valorizzato e presente in prodotti → costo da anagrafica
  costo_manuale   numeric,          -- fallback se nessun codice / non trovato
  usa_listino     boolean NOT NULL DEFAULT false,  -- TRUE = prezzo_listino (Flexmove); placeholder finché non disponibile
  ricarico_default numeric(6,3) NOT NULL DEFAULT 0.5,
  qta_formula     text,             -- es. "(larghezza/1000)*n_gradini"; se null usa qta_manuale
  qta_manuale     numeric NOT NULL DEFAULT 0,
  gruppo          text,             -- es. "materie_prime", "trattamenti", "accessori"
  ordine          integer NOT NULL DEFAULT 0,
  UNIQUE (template_id, slug)
);

-- unita_tempo: min | h ; modalita: per_pezzo | una_tantum
CREATE TABLE IF NOT EXISTS preventivatore.template_righe_manodopera (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id     uuid NOT NULL REFERENCES preventivatore.template(id) ON DELETE CASCADE,
  label           text NOT NULL,
  tariffa_default numeric NOT NULL DEFAULT 0,
  unita_tempo     text NOT NULL DEFAULT 'h' CHECK (unita_tempo IN ('min','h')),
  tempo_formula   text,             -- es. "n_gradini*5"; se null usa tempo_default come valore iniziale
  tempo_default   numeric NOT NULL DEFAULT 0,
  modalita        text NOT NULL DEFAULT 'per_pezzo' CHECK (modalita IN ('per_pezzo','una_tantum')),
  ricarico_default numeric(6,3) NOT NULL DEFAULT 0.7,
  ordine          integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS template_parametri_tpl ON preventivatore.template_parametri(template_id);
CREATE INDEX IF NOT EXISTS template_righe_mat_tpl ON preventivatore.template_righe_materiale(template_id);
CREATE INDEX IF NOT EXISTS template_righe_man_tpl ON preventivatore.template_righe_manodopera(template_id);

-- RLS: lettura agli autenticati; scritture via service role (createAdminClient) dopo check admin lato route.
ALTER TABLE preventivatore.template                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE preventivatore.template_parametri        ENABLE ROW LEVEL SECURITY;
ALTER TABLE preventivatore.template_righe_materiale  ENABLE ROW LEVEL SECURITY;
ALTER TABLE preventivatore.template_righe_manodopera ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='preventivatore' AND tablename='template' AND policyname='template_select_auth') THEN
    CREATE POLICY template_select_auth ON preventivatore.template FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='preventivatore' AND tablename='template_parametri' AND policyname='template_parametri_select_auth') THEN
    CREATE POLICY template_parametri_select_auth ON preventivatore.template_parametri FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='preventivatore' AND tablename='template_righe_materiale' AND policyname='template_righe_mat_select_auth') THEN
    CREATE POLICY template_righe_mat_select_auth ON preventivatore.template_righe_materiale FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='preventivatore' AND tablename='template_righe_manodopera' AND policyname='template_righe_man_select_auth') THEN
    CREATE POLICY template_righe_man_select_auth ON preventivatore.template_righe_manodopera FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
