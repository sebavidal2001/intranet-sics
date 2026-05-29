-- Migration 054: salvataggio template ATOMICO.
-- Sostituisce il salvataggio multi-step del route (update + delete/insert separati)
-- con una singola funzione plpgsql → tutto in una transazione, rollback totale su errore.

CREATE OR REPLACE FUNCTION preventivatore.salva_template_full(p_id uuid, p_payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE preventivatore.template SET
    nome = COALESCE(NULLIF(p_payload->>'nome',''), nome),
    descrizione = NULLIF(p_payload->>'descrizione',''),
    attivo = COALESCE((p_payload->>'attivo')::boolean, attivo),
    ordine = COALESCE(NULLIF(p_payload->>'ordine','')::int, ordine),
    consegna_settimane_min = NULLIF(p_payload->>'consegna_settimane_min','')::smallint,
    consegna_settimane_max = NULLIF(p_payload->>'consegna_settimane_max','')::smallint,
    imballaggio_pct = COALESCE(NULLIF(p_payload->>'imballaggio_pct','')::numeric, imballaggio_pct),
    tempi_accessori_pct = COALESCE(NULLIF(p_payload->>'tempi_accessori_pct','')::numeric, tempi_accessori_pct),
    spese_generali_pct = COALESCE(NULLIF(p_payload->>'spese_generali_pct','')::numeric, spese_generali_pct),
    margine_default_pct = COALESCE(NULLIF(p_payload->>'margine_default_pct','')::numeric, margine_default_pct),
    ricarico_materiale_default = COALESCE(NULLIF(p_payload->>'ricarico_materiale_default','')::numeric, ricarico_materiale_default),
    ricarico_manodopera_default = COALESCE(NULLIF(p_payload->>'ricarico_manodopera_default','')::numeric, ricarico_manodopera_default),
    usa_catena_guida = COALESCE((p_payload->>'usa_catena_guida')::boolean, usa_catena_guida),
    costo_catena_m = COALESCE(NULLIF(p_payload->>'costo_catena_m','')::numeric, costo_catena_m),
    costo_guida_m = COALESCE(NULLIF(p_payload->>'costo_guida_m','')::numeric, costo_guida_m),
    catena_codice = NULLIF(p_payload->>'catena_codice',''),
    catena_descrizione = NULLIF(p_payload->>'catena_descrizione',''),
    catena_ricarico = COALESCE(NULLIF(p_payload->>'catena_ricarico','')::numeric, catena_ricarico),
    guida_codice = NULLIF(p_payload->>'guida_codice',''),
    guida_descrizione = NULLIF(p_payload->>'guida_descrizione',''),
    guida_ricarico = COALESCE(NULLIF(p_payload->>'guida_ricarico','')::numeric, guida_ricarico),
    updated_at = now()
  WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Template % non trovato', p_id; END IF;

  -- Parametri
  IF p_payload ? 'parametri' THEN
    DELETE FROM preventivatore.template_parametri WHERE template_id = p_id;
    INSERT INTO preventivatore.template_parametri (template_id, slug, label, tipo, unita, valore_default, opzioni, ordine)
    SELECT p_id, e->>'slug', e->>'label',
           COALESCE(NULLIF(e->>'tipo',''),'number'), NULLIF(e->>'unita',''), e->>'valore_default',
           CASE WHEN jsonb_typeof(e->'opzioni')='array' THEN e->'opzioni' ELSE NULL END,
           (ord-1)::int
    FROM jsonb_array_elements(p_payload->'parametri') WITH ORDINALITY AS t(e, ord)
    WHERE COALESCE(e->>'slug','') <> '' AND COALESCE(e->>'label','') <> '';
  END IF;

  -- Righe materiale
  IF p_payload ? 'righe_materiale' THEN
    DELETE FROM preventivatore.template_righe_materiale WHERE template_id = p_id;
    INSERT INTO preventivatore.template_righe_materiale
      (template_id, slug, descrizione, codice_articolo, costo_manuale, usa_listino, ricarico_default,
       qta_formula, qta_manuale, gruppo, metri_catena, metri_guida, ordine)
    SELECT p_id, NULLIF(e->>'slug',''), e->>'descrizione', NULLIF(e->>'codice_articolo',''),
           NULLIF(e->>'costo_manuale','')::numeric, COALESCE((e->>'usa_listino')::boolean, false),
           COALESCE(NULLIF(e->>'ricarico_default','')::numeric, 0.5), NULLIF(e->>'qta_formula',''),
           COALESCE(NULLIF(e->>'qta_manuale','')::numeric, 0), NULLIF(e->>'gruppo',''),
           COALESCE(NULLIF(e->>'metri_catena','')::numeric, 0), COALESCE(NULLIF(e->>'metri_guida','')::numeric, 0),
           (ord-1)::int
    FROM jsonb_array_elements(p_payload->'righe_materiale') WITH ORDINALITY AS t(e, ord)
    WHERE COALESCE(e->>'descrizione','') <> '';
  END IF;

  -- Righe manodopera
  IF p_payload ? 'righe_manodopera' THEN
    DELETE FROM preventivatore.template_righe_manodopera WHERE template_id = p_id;
    INSERT INTO preventivatore.template_righe_manodopera
      (template_id, label, tariffa_default, unita_tempo, tempo_formula, tempo_default, modalita, ricarico_default, ordine)
    SELECT p_id, e->>'label', COALESCE(NULLIF(e->>'tariffa_default','')::numeric, 0),
           CASE WHEN e->>'unita_tempo'='min' THEN 'min' ELSE 'h' END, NULLIF(e->>'tempo_formula',''),
           COALESCE(NULLIF(e->>'tempo_default','')::numeric, 0),
           CASE WHEN e->>'modalita'='una_tantum' THEN 'una_tantum' ELSE 'per_pezzo' END,
           COALESCE(NULLIF(e->>'ricarico_default','')::numeric, 0.7), (ord-1)::int
    FROM jsonb_array_elements(p_payload->'righe_manodopera') WITH ORDINALITY AS t(e, ord)
    WHERE COALESCE(e->>'label','') <> '';
  END IF;
END;
$function$;
