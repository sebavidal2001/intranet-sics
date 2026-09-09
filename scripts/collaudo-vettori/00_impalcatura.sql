-- Impalcatura di collaudo — NON è una migration del progetto.
--
-- Ricostruisce le sole dipendenze che le migration 087/088/089 presuppongono,
-- copiate dalle definizioni reali del repo (004_intranet_schema.sql per portali,
-- permessi_portale e permessi_utente; 012 per get_portale_livello).
--
-- Serve a far girare le migration su un PostgreSQL vuoto e isolato. Non
-- riproduce l'intranet: riproduce esattamente ciò che le migration toccano.

-- Ruoli che le migration citano nei GRANT/REVOKE
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')  THEN CREATE ROLE service_role  NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')          THEN CREATE ROLE anon          NOLOGIN; END IF;
END $$;

-- Schema auth, per le foreign key su auth.users
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text
);

-- Anagrafica utenti dell'intranet
CREATE TABLE IF NOT EXISTS public.utenti (
  id      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome    text,
  cognome text,
  ruolo   text NOT NULL DEFAULT 'collaboratore',
  stato   text NOT NULL DEFAULT 'attivo'
);

CREATE TABLE IF NOT EXISTS portali (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  descrizione text,
  icona       text,
  colore      text,
  ordine      int NOT NULL DEFAULT 0,
  is_attivo   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS permessi_portale (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portale_id  uuid NOT NULL REFERENCES portali(id) ON DELETE CASCADE,
  ruolo       text NOT NULL,
  can_access  boolean NOT NULL DEFAULT false,
  can_export  boolean NOT NULL DEFAULT false,
  can_approve boolean NOT NULL DEFAULT false,
  UNIQUE (portale_id, ruolo)
);

CREATE TABLE IF NOT EXISTS permessi_utente (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  utente_id       uuid NOT NULL REFERENCES public.utenti(id) ON DELETE CASCADE,
  portale_id      uuid NOT NULL REFERENCES portali(id) ON DELETE CASCADE,
  is_portal_admin boolean NOT NULL DEFAULT false,
  override_export boolean NOT NULL DEFAULT false,
  override_access boolean NOT NULL DEFAULT false,
  UNIQUE (utente_id, portale_id)
);

-- Copia letterale della funzione della migration 012
CREATE OR REPLACE FUNCTION get_portale_livello(p_user_id UUID, p_slug TEXT)
RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM utenti WHERE id = p_user_id AND ruolo = 'superadmin') THEN 'superadmin'
    WHEN EXISTS (
      SELECT 1 FROM permessi_utente pu JOIN portali p ON p.id = pu.portale_id
      WHERE pu.utente_id = p_user_id AND p.slug = p_slug AND pu.is_portal_admin = true
    ) THEN 'admin'
    WHEN EXISTS (
      SELECT 1 FROM permessi_utente pu JOIN portali p ON p.id = pu.portale_id
      WHERE pu.utente_id = p_user_id AND p.slug = p_slug AND pu.override_export = true
    ) THEN 'exporter'
    WHEN EXISTS (
      SELECT 1 FROM permessi_utente pu JOIN portali p ON p.id = pu.portale_id
      WHERE pu.utente_id = p_user_id AND p.slug = p_slug AND pu.override_access = true
    ) THEN 'viewer'
    WHEN EXISTS (
      SELECT 1 FROM utenti u JOIN permessi_portale pp ON pp.ruolo = u.ruolo
      JOIN portali p ON p.id = pp.portale_id
      WHERE u.id = p_user_id AND p.slug = p_slug AND pp.can_approve = true AND p.is_attivo = true
    ) THEN 'admin'
    WHEN EXISTS (
      SELECT 1 FROM utenti u JOIN permessi_portale pp ON pp.ruolo = u.ruolo
      JOIN portali p ON p.id = pp.portale_id
      WHERE u.id = p_user_id AND p.slug = p_slug AND pp.can_export = true AND p.is_attivo = true
    ) THEN 'exporter'
    WHEN EXISTS (
      SELECT 1 FROM utenti u JOIN permessi_portale pp ON pp.ruolo = u.ruolo
      JOIN portali p ON p.id = pp.portale_id
      WHERE u.id = p_user_id AND p.slug = p_slug AND pp.can_access = true AND p.is_attivo = true
    ) THEN 'viewer'
    ELSE NULL
  END;
$$;

-- Tre utenti di prova, uno per ruolo funzionale
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'amministrazione@test'),
  ('22222222-2222-2222-2222-222222222222', 'magazzino@test'),
  ('33333333-3333-3333-3333-333333333333', 'estraneo@test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.utenti (id, nome, cognome, ruolo) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Anna', 'Amministrazione', 'amministratore'),
  ('22222222-2222-2222-2222-222222222222', 'Mario', 'Magazzino', 'collaboratore'),
  ('33333333-3333-3333-3333-333333333333', 'Elena', 'Estranea', 'collaboratore')
ON CONFLICT (id) DO NOTHING;
