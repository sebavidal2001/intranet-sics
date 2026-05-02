-- ============================================================
-- Migration 020: Registrazione portale Preventivatore
-- ============================================================

-- Inserisce il portale (idempotente via ON CONFLICT DO NOTHING)
INSERT INTO portali (nome, slug, descrizione, icona, colore, ordine, is_attivo)
VALUES (
  'Preventivatore',
  'preventivatore',
  'AI Pre-Sales Builder per offerte tecniche strutture metalliche',
  'Calculator',
  '#00a1be',
  2,
  true
)
ON CONFLICT (slug) DO NOTHING;

-- Permessi di default per ruolo admin (can_access + can_export + can_approve)
INSERT INTO permessi_portale (portale_id, ruolo, can_access, can_export, can_approve)
SELECT id, 'admin', true, true, true
FROM portali WHERE slug = 'preventivatore'
ON CONFLICT DO NOTHING;
