-- ============================================================
-- Migration 018: Indici di performance
--
-- Aggiunge indici sulle colonne più utilizzate nelle query.
-- Nessuna modifica allo schema o ai dati.
-- Nota: risposte_valutazione ha già unique indexes parziali
-- creati in 009 (risposte_val_mansione_uniq, risposte_val_skill_uniq).
-- ============================================================

-- sessioni_utente
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_sessioni_utente_id
  ON sessioni_utente(utente_id);

CREATE INDEX IF NOT EXISTS idx_sessioni_anno
  ON sessioni_utente(anno);

CREATE INDEX IF NOT EXISTS idx_sessioni_responsabile
  ON sessioni_utente(responsabile_id);

-- Indice composto per la query più comune: sessioni di un utente per anno
CREATE INDEX IF NOT EXISTS idx_sessioni_utente_anno
  ON sessioni_utente(utente_id, anno);

-- risposte_valutazione
-- ============================================================
-- Usata in quasi ogni query del sistema (radar, certificato, analisi)
CREATE INDEX IF NOT EXISTS idx_risposte_sessione
  ON risposte_valutazione(sessione_utente_id);

CREATE INDEX IF NOT EXISTS idx_risposte_mansione
  ON risposte_valutazione(mansione_id);

CREATE INDEX IF NOT EXISTS idx_risposte_skill
  ON risposte_valutazione(skill_id);

CREATE INDEX IF NOT EXISTS idx_risposte_tipo
  ON risposte_valutazione(tipo);

-- Indice composto per filtraggio per sessione + tipo
CREATE INDEX IF NOT EXISTS idx_risposte_sessione_tipo
  ON risposte_valutazione(sessione_utente_id, tipo);

-- utente_mansioni
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_utente_mansioni_utente
  ON utente_mansioni(utente_id);

CREATE INDEX IF NOT EXISTS idx_utente_mansioni_mansione
  ON utente_mansioni(mansione_id);

-- mansioni
-- ============================================================
-- Usata in radar-service.ts per mappare mansione → parametro_radar
CREATE INDEX IF NOT EXISTS idx_mansioni_parametro
  ON mansioni(parametro_radar_id);

CREATE INDEX IF NOT EXISTS idx_mansioni_ruolo
  ON mansioni(ruolo_professionale_id);

-- skills
-- ============================================================
-- Usata in radar-service.ts per mappare skill → parametro_radar
CREATE INDEX IF NOT EXISTS idx_skills_parametro
  ON skills(parametro_radar_id);

-- permessi_utente
-- ============================================================
-- Usata in ogni check di accesso portale
CREATE INDEX IF NOT EXISTS idx_permessi_utente_ids
  ON permessi_utente(utente_id, portale_id);

-- utenti
-- ============================================================
-- Ricerca per email (usata in import storico e mansionari)
CREATE INDEX IF NOT EXISTS idx_utenti_email
  ON utenti(email);

-- Filtraggio per reparto (usato in admin/valutazioni)
CREATE INDEX IF NOT EXISTS idx_utenti_reparto
  ON utenti(reparto);

-- storico_punteggi
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_storico_utente
  ON storico_punteggi(utente_id);
