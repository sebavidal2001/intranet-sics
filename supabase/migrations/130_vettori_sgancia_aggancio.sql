-- 130_vettori_sgancia_aggancio.sql
--
-- Annullare un aggancio fattura -> bolla sbagliato.
--
-- Fino a oggi non si poteva dall'interfaccia: «scongela» (100) toglie il
-- congelamento ma la riga di fattura resta legata alla bolla. Qui, in una
-- transazione, con il motivo obbligatorio:
--   1. il controllo si stacca dalla bolla e torna 'assistito' (cosi' riappare
--      fra le righe da agganciare in Spedizioni);
--   2. se nessun'altra riga di fattura usa quella bolla, la bolla si scongela
--      (prima: il trigger 100 vieta di cambiarle lo stato da congelata) e torna
--      'attesa'; lo scongelamento si registra in spedizioni_congelamenti con il
--      motivo, come lo scongelamento a mano;
--   3. la proposta applicata della riga passa a 'scartata', con il motivo.
--
-- Il vettore che l'aggancio aveva dato alla bolla (se non ne aveva uno) resta:
-- non si sa piu' se c'era prima. Il controllo lo rifa' l'applicazione subito dopo.

CREATE OR REPLACE FUNCTION vettori.sgancia_aggancio(
  p_riga uuid,
  p_utente uuid,
  p_motivo text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_controllo vettori.controlli%ROWTYPE;
  v_altre integer;
  v_fattura uuid;
BEGIN
  IF coalesce(btrim(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'Il motivo è obbligatorio.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_controllo FROM vettori.controlli WHERE fattura_riga_id = p_riga FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Riga di fattura senza controllo.' USING ERRCODE = 'P0001';
  END IF;
  IF v_controllo.spedizione_id IS NULL THEN
    RAISE EXCEPTION 'La riga non è agganciata a nessuna bolla.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE vettori.controlli
     SET spedizione_id = NULL,
         abbinamento = 'assistito',
         abbinato_da = NULL
   WHERE id = v_controllo.id;

  SELECT count(*) INTO v_altre FROM vettori.controlli WHERE spedizione_id = v_controllo.spedizione_id;

  IF v_altre = 0 THEN
    UPDATE vettori.spedizioni
       SET congelata = false,
           congelata_il = NULL,
           congelata_da_controllo_id = NULL,
           aggiornata_il = now()
     WHERE id = v_controllo.spedizione_id AND congelata;

    UPDATE vettori.spedizioni
       SET stato = 'attesa', aggiornata_il = now()
     WHERE id = v_controllo.spedizione_id AND stato = 'abbinata';

    INSERT INTO vettori.spedizioni_congelamenti (spedizione_id, azione, controllo_id, utente_id, motivo)
    VALUES (v_controllo.spedizione_id, 'scongelamento', v_controllo.id, p_utente,
            'Aggancio annullato: ' || btrim(p_motivo));
  END IF;

  UPDATE vettori.agganci_proposti
     SET stato = 'scartata',
         decisa_il = now(),
         decisa_da = p_utente,
         motivo = coalesce(motivo, '') || ' [Aggancio annullato: ' || btrim(p_motivo) || ']'
   WHERE fattura_riga_id = p_riga AND stato IN ('applicata', 'proposta');

  SELECT r.fattura_id INTO v_fattura FROM vettori.fatture_righe r WHERE r.id = p_riga;
  RETURN jsonb_build_object('fattura_id', v_fattura, 'spedizione_id', v_controllo.spedizione_id, 'bolla_scongelata', v_altre = 0);
END;
$$;

REVOKE ALL ON FUNCTION vettori.sgancia_aggancio(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vettori.sgancia_aggancio(uuid, uuid, text) TO service_role;
