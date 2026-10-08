-- Diagnostica in sola lettura: documenti presenti su spedizioni diverse.
SELECT
  sd.id_documento,
  count(DISTINCT sd.spedizione_id) AS numero_spedizioni,
  jsonb_agg(DISTINCT jsonb_build_object(
    'spedizione_id', s.id,
    'numero_riferimento', s.numero_riferimento,
    'data_documento', s.data_documento,
    'stato', s.stato,
    'congelata', s.congelata
  )) AS spedizioni
FROM vettori.spedizioni_documenti sd
JOIN vettori.spedizioni s ON s.id = sd.spedizione_id
GROUP BY sd.id_documento
HAVING count(DISTINCT sd.spedizione_id) > 1
ORDER BY numero_spedizioni DESC, sd.id_documento;
