-- ============================================================
-- Migration 032 — Anomaly detection per preventivi
-- ============================================================
-- Vista che calcola z-score di ogni preventivo vs media storica
-- (cliente + categoria) e classifica come molto_alto/alto/basso/molto_basso.
-- Usata dal tool AI `cerca_anomalie_importi`.

CREATE OR REPLACE VIEW preventivatore.v_anomalie_importi AS
WITH stats AS (
  SELECT
    cliente,
    categoria,
    avg(importo_preventivo)::numeric(14,2) AS media,
    stddev(importo_preventivo)::numeric(14,2) AS sigma,
    count(*)::int AS n_storico
  FROM preventivatore.documenti
  WHERE importo_preventivo IS NOT NULL AND importo_preventivo > 0
  GROUP BY cliente, categoria
  HAVING count(*) >= 3
)
SELECT
  d.id,
  d.codice,
  d.cliente,
  d.categoria,
  d.tipo_prodotto,
  d.anno,
  d.stato,
  d.importo_preventivo,
  s.media,
  s.sigma,
  s.n_storico,
  CASE
    WHEN s.sigma IS NULL OR s.sigma = 0 THEN 0::numeric(10,2)
    ELSE round((d.importo_preventivo - s.media) / s.sigma, 2)
  END AS z_score,
  CASE
    WHEN s.sigma IS NULL OR s.sigma = 0 THEN 'baseline_insufficiente'
    WHEN d.importo_preventivo > s.media + 2 * s.sigma THEN 'molto_alto'
    WHEN d.importo_preventivo > s.media + s.sigma THEN 'alto'
    WHEN d.importo_preventivo < s.media - 2 * s.sigma THEN 'molto_basso'
    WHEN d.importo_preventivo < s.media - s.sigma THEN 'basso'
    ELSE 'nella_norma'
  END AS classificazione
FROM preventivatore.documenti d
JOIN stats s ON s.cliente = d.cliente AND s.categoria = d.categoria
WHERE d.importo_preventivo IS NOT NULL;

GRANT SELECT ON preventivatore.v_anomalie_importi TO authenticated;
