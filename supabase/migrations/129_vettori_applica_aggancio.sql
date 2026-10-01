-- 129_vettori_applica_aggancio.sql
--
-- Agganciare a mano (o su proposta del modello) una riga di fattura alla sua
-- bolla, dopo che la fattura e' gia' in archivio.
--
-- Fino al 01/10/2026 non si poteva: la conferma esisteva solo nell'anteprima di
-- acquisizione, e le 310 righe «da confermare» del 2026 sono rimaste senza
-- bolla. Qui la stessa sequenza dell'acquisizione (091), in una transazione:
--   1. la bolla passa ad 'abbinata' e prende il vettore della fattura se non
--      ne ha (prima del punto 2: dopo e' congelata);
--   2. il controllo punta alla bolla, abbinamento 'manuale', con chi l'ha fatto;
--   3. il trigger congela la bolla;
--   4. la proposta viva della riga si chiude: 'applicata' se indicava questa
--      bolla, 'scartata' altrimenti.
--
-- `scarta_aggancio`: «nessuna di queste» — chiude la proposta senza agganciare.
--
-- Il ricalcolo del controllo (che ora puo' usare peso e misure della bolla) lo
-- fa l'applicazione subito dopo, con lo stesso motore dell'acquisizione.

CREATE OR REPLACE FUNCTION vettori.applica_aggancio(
  p_riga uuid,
  p_spedizione uuid,
  p_utente uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_controllo vettori.controlli%ROWTYPE;
  v_spedizione vettori.spedizioni%ROWTYPE;
  v_vettore uuid;
  v_fattura uuid;
BEGIN
  SELECT * INTO v_controllo FROM vettori.controlli WHERE fattura_riga_id = p_riga FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Riga di fattura senza controllo.' USING ERRCODE = 'P0001';
  END IF;
  IF v_controllo.spedizione_id IS NOT NULL THEN
    RAISE EXCEPTION 'La riga e'' gia'' agganciata a una bolla.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_spedizione FROM vettori.spedizioni WHERE id = p_spedizione FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bolla non trovata.' USING ERRCODE = 'P0001';
  END IF;
  IF v_spedizione.stato = 'ignorata' THEN
    RAISE EXCEPTION 'La bolla e'' esclusa dal controllo.' USING ERRCODE = 'P0001';
  END IF;
  IF v_spedizione.congelata THEN
    RAISE EXCEPTION 'La bolla e'' gia'' agganciata a un''altra fattura.' USING ERRCODE = 'P0001';
  END IF;

  SELECT f.vettore_id, f.id INTO v_vettore, v_fattura
    FROM vettori.fatture_righe r JOIN vettori.fatture f ON f.id = r.fattura_id
   WHERE r.id = p_riga;

  UPDATE vettori.spedizioni
     SET stato = 'abbinata',
         vettore_id = coalesce(vettore_id, v_vettore),
         aggiornata_il = now()
   WHERE id = p_spedizione;

  UPDATE vettori.controlli
     SET spedizione_id = p_spedizione,
         abbinamento = 'manuale',
         abbinato_da = p_utente
   WHERE id = v_controllo.id;

  UPDATE vettori.agganci_proposti
     SET stato = CASE WHEN spedizione_id = p_spedizione THEN 'applicata' ELSE 'scartata' END,
         decisa_il = now(),
         decisa_da = p_utente
   WHERE fattura_riga_id = p_riga AND stato = 'proposta';

  RETURN jsonb_build_object('fattura_id', v_fattura, 'controllo_id', v_controllo.id, 'spedizione_id', p_spedizione);
END;
$$;

CREATE OR REPLACE FUNCTION vettori.scarta_aggancio(
  p_riga uuid,
  p_utente uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_n integer;
BEGIN
  UPDATE vettori.agganci_proposti
     SET stato = 'scartata', decisa_il = now(), decisa_da = p_utente
   WHERE fattura_riga_id = p_riga AND stato = 'proposta';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('scartate', v_n);
END;
$$;

REVOKE ALL ON FUNCTION vettori.applica_aggancio(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION vettori.scarta_aggancio(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vettori.applica_aggancio(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION vettori.scarta_aggancio(uuid, uuid) TO service_role;
