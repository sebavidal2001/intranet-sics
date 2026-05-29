-- Migration 051: chiave ai_config dedicata al modello dell'assistente template.
-- Vuota = eredita (modello_scheda_tecnica → modello_generazione → fallback).
INSERT INTO preventivatore.ai_config (chiave, valore)
VALUES ('modello_template', '')
ON CONFLICT (chiave) DO NOTHING;
