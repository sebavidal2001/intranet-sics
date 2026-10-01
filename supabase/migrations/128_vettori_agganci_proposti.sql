-- 128_vettori_agganci_proposti.sql
--
-- Le proposte di aggancio fattura -> bolla fatte dall'AI, conservate.
--
-- Il 01/10/2026 e' emerso che 310 righe di fattura del 2026 erano «da
-- confermare» (abbinamento 'assistito') e nessuno le aveva mai confermate: il
-- caricamento in blocco salta l'anteprima, e dopo l'archiviazione non c'era un
-- posto dove farlo. Un modello (scelto da Sebastiano: openai/gpt-6-luna) sceglie
-- fra le bolle candidate che il codice gli propone, con sicurezza e motivo.
--
-- Perche' una tabella e non un file: la risposta del modello costa, e va
-- pagata una volta. La prova a secco scrive SOLO qui; il passaggio vero, e poi
-- il pulsante di conferma, leggono da qui senza richiamare il modello. Il
-- controllo non cambia finche' una proposta non passa a 'applicata'.
--
-- Una sola proposta viva per riga di fattura: rifare la proposta (per esempio
-- con un modello diverso) scarta la precedente, non la sovrascrive.

CREATE TABLE IF NOT EXISTS vettori.agganci_proposti (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fattura_riga_id  uuid NOT NULL REFERENCES vettori.fatture_righe(id) ON DELETE CASCADE,
  spedizione_id    uuid REFERENCES vettori.spedizioni(id) ON DELETE SET NULL,
  esito            text NOT NULL CHECK (esito IN ('scelta', 'nessuna', 'senza_candidati', 'errore')),
  sicurezza        text CHECK (sicurezza IN ('alta', 'media', 'bassa')),
  motivo           text,
  candidati        jsonb NOT NULL DEFAULT '[]'::jsonb,
  modello          text,
  token_ingresso   integer,
  token_uscita     integer,
  costo_usd        numeric(12,6),
  stato            text NOT NULL DEFAULT 'proposta' CHECK (stato IN ('proposta', 'applicata', 'scartata')),
  creata_il        timestamptz NOT NULL DEFAULT now(),
  decisa_il        timestamptz,
  decisa_da        uuid REFERENCES public.utenti(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agganci_proposti_viva
  ON vettori.agganci_proposti (fattura_riga_id) WHERE stato = 'proposta';

COMMENT ON TABLE vettori.agganci_proposti IS
  'Proposte di aggancio fattura->bolla fatte da un modello. Pagate una volta, applicate o scartate da una persona o dal passaggio di applicazione.';
COMMENT ON COLUMN vettori.agganci_proposti.candidati IS
  'Le bolle che il codice ha proposto al modello, com''erano in quel momento: senza, una scelta non si puo'' rileggere.';

ALTER TABLE vettori.agganci_proposti ENABLE ROW LEVEL SECURITY;
GRANT ALL PRIVILEGES ON vettori.agganci_proposti TO service_role;
