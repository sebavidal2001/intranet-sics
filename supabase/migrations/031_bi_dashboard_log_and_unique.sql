-- ============================================================
-- Migration 031 — BI dashboard audit log + unique constraint
-- ============================================================
-- Race condition fix per ensureDashboard (duplicate scope=team / user)
-- e audit trail per modifiche dashboard BI.

CREATE TABLE IF NOT EXISTS preventivatore.bi_dashboard_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_id  UUID NOT NULL REFERENCES preventivatore.bi_dashboards(id) ON DELETE CASCADE,
  scope         TEXT NOT NULL,
  user_id       UUID REFERENCES auth.users(id),
  action        TEXT NOT NULL,
  title         TEXT,
  n_widgets     INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bi_dashboard_log_dashboard ON preventivatore.bi_dashboard_log(dashboard_id);
CREATE INDEX IF NOT EXISTS idx_bi_dashboard_log_user ON preventivatore.bi_dashboard_log(user_id, created_at DESC);

ALTER TABLE preventivatore.bi_dashboard_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "auth_read" ON preventivatore.bi_dashboard_log
    FOR SELECT USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Unique partial indexes (PostgreSQL UNIQUE non gestisce NULL come "valore identico").
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_bi_dashboards_user
    ON preventivatore.bi_dashboards (scope, user_id)
    WHERE scope = 'user' AND user_id IS NOT NULL;
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_bi_dashboards_team
    ON preventivatore.bi_dashboards (scope)
    WHERE scope = 'team';
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;
