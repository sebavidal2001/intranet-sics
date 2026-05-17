-- ============================================================
-- Migration 030 - Preventivatore BI dashboards
-- ============================================================
-- Configurazioni persistenti per dashboard BI personali e di team.
-- I dati dei widget vengono calcolati lato API da tabelle strutturate.
-- ============================================================

CREATE TABLE IF NOT EXISTS preventivatore.bi_dashboards (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope       text NOT NULL CHECK (scope IN ('user', 'team')),
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  title       text NOT NULL DEFAULT 'Dashboard BI',
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bi_dashboards_scope_user_chk CHECK (
    (scope = 'user' AND user_id IS NOT NULL) OR
    (scope = 'team' AND user_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS bi_dashboards_one_per_user
  ON preventivatore.bi_dashboards(user_id)
  WHERE scope = 'user';

CREATE UNIQUE INDEX IF NOT EXISTS bi_dashboards_one_team
  ON preventivatore.bi_dashboards(scope)
  WHERE scope = 'team';

CREATE INDEX IF NOT EXISTS idx_bi_dashboards_scope
  ON preventivatore.bi_dashboards(scope);

CREATE OR REPLACE FUNCTION preventivatore.touch_bi_dashboards_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bi_dashboards_updated_at ON preventivatore.bi_dashboards;
CREATE TRIGGER trg_bi_dashboards_updated_at
BEFORE UPDATE ON preventivatore.bi_dashboards
FOR EACH ROW
EXECUTE FUNCTION preventivatore.touch_bi_dashboards_updated_at();

ALTER TABLE preventivatore.bi_dashboards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_read_bi_dashboards" ON preventivatore.bi_dashboards;
CREATE POLICY "auth_read_bi_dashboards"
ON preventivatore.bi_dashboards
FOR SELECT
TO authenticated
USING (scope = 'team' OR user_id = auth.uid());

DROP POLICY IF EXISTS "auth_insert_own_or_team_bi_dashboards" ON preventivatore.bi_dashboards;
CREATE POLICY "auth_insert_own_or_team_bi_dashboards"
ON preventivatore.bi_dashboards
FOR INSERT
TO authenticated
WITH CHECK (scope = 'team' OR user_id = auth.uid());

DROP POLICY IF EXISTS "auth_update_own_or_team_bi_dashboards" ON preventivatore.bi_dashboards;
CREATE POLICY "auth_update_own_or_team_bi_dashboards"
ON preventivatore.bi_dashboards
FOR UPDATE
TO authenticated
USING (scope = 'team' OR user_id = auth.uid())
WITH CHECK (scope = 'team' OR user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE ON preventivatore.bi_dashboards TO authenticated;
