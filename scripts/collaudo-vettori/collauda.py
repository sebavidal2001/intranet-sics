# -*- coding: utf-8 -*-
"""
Collaudo delle migration 087/088/089 del Portale Controllo Vettori.

Le applica su un PostgreSQL vuoto, isolato e usa e getta — nessun database di
produzione viene toccato — e poi verifica non solo che girino, ma che i vincoli
MORDANO. Una tabella che accetta tutto non protegge niente, e un collaudo che
non prova a rompere le cose non sta collaudando.

Uso:
    pip install pgserver
    python scripts/collaudo-vettori/collauda.py

Il cluster finisce in `scripts/collaudo-vettori/.pg/` e si può cancellare a mano
in qualunque momento. Per ripartire davvero da zero, cancellarlo PRIMA di
lanciare: è l'unico modo di collaudare il percorso di prima installazione invece
di quello incrementale.

In coda rigenera `src/tests/fixtures/vettori-listini-dal-db.json`, la fixture su
cui gira `src/tests/vettori-listini-db.test.ts`. Chi cambia una tariffa nella
088 deve rilanciare questo script, altrimenti quel test resta verde ma bugiardo.
"""
import json
import pathlib
import sys

import pgserver

QUI = pathlib.Path(__file__).resolve().parent
REPO = QUI.parent.parent
(QUI / ".pg").mkdir(parents=True, exist_ok=True)
SRV = pgserver.get_server(str(QUI / ".pg" / "cluster"), cleanup_mode=None)

ok = 0
ko = 0


def q(sql: str) -> str:
    return SRV.psql("\\set ON_ERROR_STOP on\n" + sql)


def scalar(sql: str) -> str:
    out = SRV.psql("\\set ON_ERROR_STOP on\n\\pset tuples_only on\n\\pset format unaligned\n" + sql)
    # psql conferma a voce ogni \pset: quelle righe non sono il risultato.
    rumore = ("Output format is", "Tuples only is", "Showing only tuples")
    righe = [r for r in out.splitlines() if not r.startswith(rumore)]
    return "\n".join(righe).strip()


def check(nome: str, atteso, ottenuto):
    global ok, ko
    if str(atteso) == str(ottenuto):
        print(f"  OK    {nome}")
        ok += 1
    else:
        print(f"  FALLITO  {nome}: atteso {atteso!r}, ottenuto {ottenuto!r}")
        ko += 1


def deve_fallire(nome: str, sql: str):
    """Il vincolo deve rifiutare. Se passa, il vincolo non c'e' o non morde."""
    global ok, ko
    try:
        q("BEGIN;\n" + sql + "\nROLLBACK;")
        print(f"  FALLITO  {nome}: il database ha ACCETTATO quello che doveva rifiutare")
        ko += 1
    except Exception:
        print(f"  OK    {nome} (rifiutato, come deve)")
        ok += 1


MIGRATIONS = (
    "087_portale_vettori_listini",
    "088_vettori_listini_2026",
    "089_vettori_operativo",
    "090_bi_trasporti_documenti",
    "091_vettori_acquisisci_fattura",
)

print("=" * 72)
print("0. PRIMA INSTALLAZIONE — impalcatura e migration su database vuoto")
print("=" * 72)

schema_gia_presente = (
    scalar("SELECT count(*) FROM information_schema.schemata WHERE schema_name='vettori';") != "0"
)
if schema_gia_presente:
    print("  (schema `vettori` già presente: si collauda il percorso incrementale.")
    print("   Per collaudare la prima installazione, cancellare scripts/collaudo-vettori/.pg/)")
else:
    passi = [("impalcatura", QUI / "00_impalcatura.sql")] + [
        (m, REPO / "supabase" / "migrations" / f"{m}.sql") for m in MIGRATIONS
    ]
    for nome, f in passi:
        try:
            q(f.read_text(encoding="utf-8"))
            print(f"  OK    {nome} applicata")
            ok += 1
        except Exception as e:
            print(f"  FALLITO  {nome}: {str(e).splitlines()[-1][:200]}")
            ko += 1
            print("\nInstallazione interrotta: inutile proseguire il collaudo.")
            sys.exit(1)

print()
print("=" * 72)
print("1. IDEMPOTENZA — rieseguire le migration non deve rompere né duplicare")
print("=" * 72)

repo = REPO
prima = scalar("SELECT count(*) FROM vettori.listini_fasce;")
for f in MIGRATIONS:
    try:
        q((repo / f"supabase/migrations/{f}.sql").read_text(encoding="utf-8"))
        print(f"  OK    {f} rieseguita")
        ok += 1
    except Exception as e:
        print(f"  FALLITO  {f} alla seconda esecuzione: {str(e).splitlines()[-1][:150]}")
        ko += 1
dopo = scalar("SELECT count(*) FROM vettori.listini_fasce;")
check("le fasce non si duplicano alla riesecuzione", prima, dopo)
check("i vettori non si duplicano", "4", scalar("SELECT count(*) FROM vettori.vettori;"))
check("il portale non si duplica", "1", scalar("SELECT count(*) FROM portali WHERE slug='vettori';"))

print()
print("=" * 72)
print("2. DATI SEMINATI")
print("=" * 72)
check("vettori a nostro carico", "4", scalar("SELECT count(*) FROM vettori.vettori WHERE a_nostro_carico;"))
check("zone", "6", scalar("SELECT count(*) FROM vettori.zone;"))
check("province coperte", "48", scalar("SELECT count(*) FROM vettori.zone_province;"))
check("listini aperti", "4", scalar("SELECT count(*) FROM vettori.listini WHERE valido_al IS NULL;"))
check("fasce di peso (8+8+8 GLS, 11 TNT, 12 FedEx, 9 TP)", "56", scalar("SELECT count(*) FROM vettori.listini_fasce;"))
check("supplementi", "17", scalar("SELECT count(*) FROM vettori.listini_supplementi;"))
check("adeguamenti (solo GLS)", "1", scalar("SELECT count(*) FROM vettori.adeguamenti;"))
check("carburante luglio", "3", scalar("SELECT count(*) FROM vettori.carburante WHERE anno=2026 AND mese=7;"))
check("scaglioni riaddebito", "5", scalar("SELECT count(*) FROM vettori.riaddebito_scaglioni;"))
check("ruoli funzionali", "3", scalar("SELECT count(*) FROM vettori.ruoli_funzionali;"))
check("modello mail predefinito", "1", scalar("SELECT count(*) FROM vettori.mail_modelli WHERE vettore_id IS NULL AND attivo;"))
check(
    "Trading Post: minimo 3 kg e arrotondamento 100 oltre 100",
    "3.000|100.000|100.000",
    scalar(
        "SELECT peso_minimo_tassabile||'|'||arrotondamento_kg||'|'||arrotondamento_da_kg "
        "FROM vettori.vettori WHERE codice='trading_post';"
    ),
)
check(
    "divisori volumetrici",
    "fedex=250.00 gls=300.00 tnt=250.00 trading_post=300.00",
    scalar(
        "SELECT string_agg(codice||'='||divisore_volumetrico, ' ' ORDER BY codice) FROM vettori.vettori;"
    ),
)
check(
    "assicurazione GLS fuori dalla base del carburante",
    "f",
    scalar(
        "SELECT s.base_nolo FROM vettori.listini_supplementi s "
        "JOIN vettori.listini l ON l.id=s.listino_id JOIN vettori.vettori v ON v.id=l.vettore_id "
        "WHERE v.codice='gls' AND s.codice='assicurazione';"
    ),
)
check(
    "Trading Post non ha zona di ripiego",
    "0",
    scalar(
        "SELECT count(*) FROM vettori.zone z JOIN vettori.vettori v ON v.id=z.vettore_id "
        "WHERE v.codice='trading_post' AND z.is_default;"
    ),
)

print()
print("=" * 72)
print("3. I VINCOLI DEVONO MORDERE")
print("=" * 72)

deve_fallire(
    "due listini aperti per lo stesso vettore",
    "INSERT INTO vettori.listini (vettore_id, etichetta, valido_dal) "
    "SELECT id, 'doppione', '2026-06-01' FROM vettori.vettori WHERE codice='gls';",
)
deve_fallire(
    "due zone di ripiego per lo stesso vettore",
    "INSERT INTO vettori.zone (vettore_id, codice, nome, is_default) "
    "SELECT id, 'X', 'Seconda default', true FROM vettori.vettori WHERE codice='gls';",
)
deve_fallire(
    "fascia con peso_a minore di peso_da",
    "INSERT INTO vettori.listini_fasce (listino_id, zona_id, peso_da, peso_a, importo) "
    "SELECT l.id, z.id, 50, 10, 1 FROM vettori.listini l JOIN vettori.zone z ON z.vettore_id=l.vettore_id LIMIT 1;",
)
deve_fallire(
    "scatto_kg senza scatto_importo",
    "INSERT INTO vettori.listini_fasce (listino_id, zona_id, peso_da, peso_a, importo, scatto_kg) "
    "SELECT l.id, z.id, 500, NULL, 1, 50 FROM vettori.listini l JOIN vettori.zone z ON z.vettore_id=l.vettore_id LIMIT 1;",
)
deve_fallire(
    "carburante con mese 13",
    "INSERT INTO vettori.carburante (vettore_id, anno, mese, percentuale) "
    "SELECT id, 2026, 13, 0.1 FROM vettori.vettori WHERE codice='gls';",
)
deve_fallire(
    "spedizione con direzione inventata",
    "INSERT INTO vettori.spedizioni (direzione, data_documento) VALUES ('laterale', '2026-07-01');",
)
deve_fallire(
    "due fatture con lo stesso file",
    "INSERT INTO vettori.fatture (vettore_id, numero, data_fattura, anno, mese, hash_file) "
    "SELECT id, 'A', '2026-07-31', 2026, 7, 'abc' FROM vettori.vettori WHERE codice='gls'; "
    "INSERT INTO vettori.fatture (vettore_id, numero, data_fattura, anno, mese, hash_file) "
    "SELECT id, 'B', '2026-08-31', 2026, 8, 'abc' FROM vettori.vettori WHERE codice='gls';",
)
deve_fallire(
    "anomalia accettata senza motivazione",
    "INSERT INTO vettori.anomalie (tipo, descrizione, stato) "
    "VALUES ('importo_oltre_soglia', 'prova', 'accettata');",
)
deve_fallire(
    "riaddebito cliente a importo fisso senza importo",
    "INSERT INTO vettori.riaddebito_clienti (codice_cliente, valido_dal, modalita) "
    "VALUES ('X', '2026-01-01', 'importo_fisso');",
)
deve_fallire(
    "controllo con esito inventato",
    "INSERT INTO vettori.controlli (fattura_riga_id, esito) "
    "SELECT gen_random_uuid(), 'boh';",
)

print()
print("  Controprova — quello che DEVE passare, passa:")
try:
    q(
        "BEGIN;"
        "INSERT INTO vettori.spedizioni (direzione, data_documento, numero_riferimento, numero_riferimento_norm, controparte_codice) "
        "VALUES ('entrata', '2026-07-01', '764', '764', 'CKD');"
        "INSERT INTO vettori.rilevazioni (numero_bolla, colli, peso_kg, lunghezza_cm, larghezza_cm, altezza_cm, condizioni) "
        "VALUES ('764', 1, 5.0, 40, 30, 20, ARRAY['bancale']);"
        "ROLLBACK;"
    )
    print("  OK    spedizione e rilevazione valide vengono accettate")
    ok += 1
except Exception as e:
    print(f"  FALLITO  una riga valida e' stata rifiutata: {str(e).splitlines()[-1][:150]}")
    ko += 1

print()
print("=" * 72)
print("4. PERMESSI — la RPC get_vettori_context")
print("=" * 72)

q(
    """
    INSERT INTO permessi_utente (utente_id, portale_id, is_portal_admin)
    SELECT '11111111-1111-1111-1111-111111111111', id, true FROM portali WHERE slug='vettori'
    ON CONFLICT DO NOTHING;
    INSERT INTO permessi_utente (utente_id, portale_id, override_access)
    SELECT '22222222-2222-2222-2222-222222222222', id, true FROM portali WHERE slug='vettori'
    ON CONFLICT DO NOTHING;
    INSERT INTO vettori.utente_ruoli_funzionali (utente_id, ruolo_id)
    SELECT '11111111-1111-1111-1111-111111111111', id FROM vettori.ruoli_funzionali WHERE slug='amministrazione'
    ON CONFLICT DO NOTHING;
    INSERT INTO vettori.utente_ruoli_funzionali (utente_id, ruolo_id)
    SELECT '22222222-2222-2222-2222-222222222222', id FROM vettori.ruoli_funzionali WHERE slug='magazzino'
    ON CONFLICT DO NOTHING;
    """
)

check(
    "amministrazione: livello admin, ruolo amministrazione",
    'admin|["amministrazione"]',
    scalar(
        "SELECT (public.get_vettori_context('11111111-1111-1111-1111-111111111111')->>'livello')"
        "||'|'||(public.get_vettori_context('11111111-1111-1111-1111-111111111111')->'ruoli')::text;"
    ),
)
check(
    "magazzino: livello viewer, ruolo magazzino",
    'viewer|["magazzino"]',
    scalar(
        "SELECT (public.get_vettori_context('22222222-2222-2222-2222-222222222222')->>'livello')"
        "||'|'||(public.get_vettori_context('22222222-2222-2222-2222-222222222222')->'ruoli')::text;"
    ),
)
check(
    "estraneo: nessun accesso e nessun ruolo",
    "|[]",
    scalar(
        "SELECT coalesce(public.get_vettori_context('33333333-3333-3333-3333-333333333333')->>'livello','')"
        "||'|'||(public.get_vettori_context('33333333-3333-3333-3333-333333333333')->'ruoli')::text;"
    ),
)
check(
    "la RPC non e' eseguibile da anon",
    "f",
    scalar("SELECT has_function_privilege('anon','public.get_vettori_context(uuid)','execute');"),
)
check(
    "authenticated NON ha accesso diretto alle tabelle",
    "f",
    scalar("SELECT has_table_privilege('authenticated','vettori.listini','select');"),
)
check(
    "service_role SI",
    "t",
    scalar("SELECT has_table_privilege('service_role','vettori.listini','select');"),
)
check(
    "RLS attiva su tutte le tabelle dello schema",
    "0",
    scalar(
        "SELECT count(*) FROM pg_tables WHERE schemaname='vettori' AND NOT rowsecurity;"
    ),
)

print()
print("=" * 72)
print("5. ACQUISIZIONE DI UNA FATTURA — la RPC, in una sola transazione")
print("=" * 72)

PAYLOAD = json.dumps(
    {
        "vettore_codice": "gls",
        "numero": "TEST-1",
        "data_fattura": "2026-07-31",
        "anno": 2026,
        "mese": 7,
        "nome_file": "prova.pdf",
        "hash_file": "hash-di-prova",
        "metodo_lettura": "testo",
        "quadratura_ok": True,
        "quadratura_note": "",
        "utente_id": "11111111-1111-1111-1111-111111111111",
        "totali": {
            "nolo": 1013.22, "supplementi": 11.0, "adeguamento": 73.03,
            "carburante": 141.21, "totaleDocumento": 1238.46,
            "percentualeCarburante": 0.13,
        },
        "spedizioni": [
            {
                "chiave": "entrata|CKD|764|2026-06-30",
                "direzione": "entrata", "riferimento": "764", "riferimentoNorm": "764",
                "dataDocumento": "2026-06-30", "codiceControparte": "CKD",
                "controparte": "CKD ITALIA srl", "zonaCap": "10071",
                "zonaProvincia": "TO", "portoCodice": "02",
                "porto": "ASSEGNATO", "aNostroCarico": True,
                "colli": 1, "peso": 5.0, "idDocumenti": [900001, 900002],
            }
        ],
        "righe": [
            {
                "riga_numero": 1, "data": "2026-07-01",
                "numero_spedizione": "260134364", "riferimento": "764",
                "riferimento_norm": "764", "controparte": "CKD ITALIA SRL (T1",
                "direzione": "entrata", "colli": 1, "peso": 5.0,
                "peso_volumetrico": 6.6, "peso_tassato": None,
                "nolo": 11.58, "supplementi": 0, "adeguamento": 0,
                "carburante": 0, "totale": 11.58, "dettaglio": {},
                "spedizione_chiave": "entrata|CKD|764|2026-06-30",
                "abbinamento": "numero",
                "controllo": {
                    "listino_etichetta": "Tariffe nazionali 2026", "zona_codice": "IT",
                    "perc_adeguamento": 0.0721, "perc_carburante": 0.13,
                    "peso_reale": 5.0, "peso_volumetrico": 6.6,
                    "peso_tassabile": 6.6, "peso_applicato": "volumetrico",
                    "atteso_nolo": 9.63, "atteso_imponibile": 10.23,
                    "atteso_adeguamento": 0.74, "atteso_carburante": 1.43,
                    "atteso_fuori_base": 0, "atteso_totale": 12.4,
                    "atteso_dettaglio": [{"codice": "handling", "importo": 0.2}],
                    "scostamento": -0.066, "esito": "da_verificare",
                    "avvertenze": ["prova"],
                },
                "anomalie": [
                    {"tipo": "importo_oltre_soglia", "gravita": "da_verificare",
                     "descrizione": "prova", "importo": 0.82}
                ],
            }
        ],
    },
    ensure_ascii=False,
)

esito = json.loads(
    scalar("SELECT vettori.acquisisci_fattura($json$" + PAYLOAD + "$json$::jsonb);")
)
check(
    "la RPC riporta quello che ha scritto",
    "righe=1 spedizioni=1 controlli=1 anomalie=1",
    f"righe={esito['righe']} spedizioni={esito['spedizioni_nuove']} "
    f"controlli={esito['controlli']} anomalie={esito['anomalie']}",
)
check("una fattura creata", "1", scalar("SELECT count(*) FROM vettori.fatture;"))
check("una riga creata", "1", scalar("SELECT count(*) FROM vettori.fatture_righe;"))
check("una spedizione creata", "1", scalar("SELECT count(*) FROM vettori.spedizioni;"))
check(
    "i due documenti del gestionale sono legati alla spedizione",
    "2",
    scalar("SELECT count(*) FROM vettori.spedizioni_documenti;"),
)
check("un controllo creato", "1", scalar("SELECT count(*) FROM vettori.controlli;"))
check("un'anomalia creata", "1", scalar("SELECT count(*) FROM vettori.anomalie;"))
check(
    "il controllo conserva il listino applicato",
    "Tariffe nazionali 2026|IT|0.07210|0.13000",
    scalar(
        "SELECT listino_etichetta||'|'||zona_codice||'|'||perc_adeguamento||'|'||perc_carburante "
        "FROM vettori.controlli;"
    ),
)
check(
    "il controllo è legato alla spedizione giusta",
    "764",
    scalar(
        "SELECT s.numero_riferimento_norm FROM vettori.controlli c "
        "JOIN vettori.spedizioni s ON s.id = c.spedizione_id;"
    ),
)

# Lo stesso file non entra due volte.
deve_fallire(
    "ricaricare lo stesso file",
    "SELECT vettori.acquisisci_fattura($json$" + PAYLOAD + "$json$::jsonb);",
)

# Un mese chiuso non si tocca.
q(
    "INSERT INTO vettori.chiusure (vettore_id, anno, mese) "
    "SELECT id, 2026, 7 FROM vettori.vettori WHERE codice='gls';"
)
PAYLOAD2 = PAYLOAD.replace("hash-di-prova", "hash-2").replace("TEST-1", "TEST-2")
deve_fallire(
    "caricare su un mese già chiuso",
    "SELECT vettori.acquisisci_fattura($json$" + PAYLOAD2 + "$json$::jsonb);",
)
q("DELETE FROM vettori.chiusure;")

# La transazione è tutta o niente.
PAYLOAD3 = PAYLOAD.replace("hash-di-prova", "hash-3").replace("TEST-1", "TEST-3").replace(
    '"esito": "da_verificare"', '"esito": "esito_inventato"'
)
prima_f = scalar("SELECT count(*) FROM vettori.fatture;")
prima_r = scalar("SELECT count(*) FROM vettori.fatture_righe;")
try:
    q("SELECT vettori.acquisisci_fattura($json$" + PAYLOAD3 + "$json$::jsonb);")
    print("  FALLITO  un esito inventato è stato accettato")
    ko += 1
except Exception:
    print("  OK    un esito inventato viene rifiutato")
    ok += 1
check("nessuna fattura resta a metà dopo l'errore", prima_f, scalar("SELECT count(*) FROM vettori.fatture;"))
check("nessuna riga resta a metà dopo l'errore", prima_r, scalar("SELECT count(*) FROM vettori.fatture_righe;"))

# Ricaricare una spedizione già vista la riusa invece di duplicarla.
PAYLOAD4 = PAYLOAD.replace("hash-di-prova", "hash-4").replace("TEST-1", "TEST-4")
q("SELECT vettori.acquisisci_fattura($json$" + PAYLOAD4 + "$json$::jsonb);")
check(
    "la stessa spedizione non viene duplicata al secondo caricamento",
    "1",
    scalar("SELECT count(*) FROM vettori.spedizioni;"),
)
check("le due fatture convivono", "2", scalar("SELECT count(*) FROM vettori.fatture;"))

q(
    "DELETE FROM vettori.anomalie; DELETE FROM vettori.controlli; "
    "DELETE FROM vettori.fatture_righe; DELETE FROM vettori.fatture; "
    "DELETE FROM vettori.spedizioni_documenti; DELETE FROM vettori.spedizioni;"
)

print()
print("=" * 72)
print("6. ESTRAZIONE DEL LISTINO — la stessa query che usa l'applicazione")
print("=" * 72)

dump = scalar(
    """
    SELECT jsonb_pretty(jsonb_agg(x ORDER BY x->>'codice'))
    FROM (
      SELECT jsonb_build_object(
        'codice', v.codice,
        'nome', v.nome,
        'divisoreVolumetrico', v.divisore_volumetrico,
        'pesoMinimoTassabile', v.peso_minimo_tassabile,
        'arrotondamentoKg', v.arrotondamento_kg,
        'arrotondamentoDaKg', v.arrotondamento_da_kg,
        'zonaCodice', z.codice,
        'adeguamento', (SELECT a.percentuale FROM vettori.adeguamenti a
                         WHERE a.vettore_id=v.id AND a.valido_al IS NULL),
        'carburante', (SELECT c.percentuale FROM vettori.carburante c
                        WHERE c.vettore_id=v.id AND c.anno=2026 AND c.mese=7),
        'fasce', (SELECT jsonb_agg(jsonb_build_object(
                     'pesoDa', f.peso_da, 'pesoA', f.peso_a, 'importo', f.importo,
                     'tipo', f.tipo, 'scattoKg', f.scatto_kg, 'scattoImporto', f.scatto_importo
                   ) ORDER BY f.peso_da, f.tipo)
                   FROM vettori.listini_fasce f
                   WHERE f.listino_id=l.id AND f.zona_id=z.id),
        'supplementi', (SELECT jsonb_agg(jsonb_build_object(
                     'codice', s.codice, 'nome', s.nome, 'tipoCalcolo', s.tipo_calcolo,
                     'valore', s.valore, 'baseNolo', s.base_nolo, 'condizione', s.condizione,
                     'importoMinimo', s.importo_minimo, 'importoMassimo', s.importo_massimo,
                     'sogliaKgDa', s.soglia_kg_da, 'sogliaKgA', s.soglia_kg_a
                   ) ORDER BY s.ordine)
                   FROM vettori.listini_supplementi s WHERE s.listino_id=l.id)
      ) AS x
      FROM vettori.vettori v
      JOIN vettori.listini l ON l.vettore_id=v.id AND l.valido_al IS NULL
      JOIN vettori.zone z ON z.vettore_id=v.id
      WHERE v.a_nostro_carico
    ) t;
    """
)
FIXTURE = REPO / "src" / "tests" / "fixtures" / "vettori-listini-dal-db.json"
FIXTURE.parent.mkdir(parents=True, exist_ok=True)
FIXTURE.write_text(dump, encoding="utf-8")
dati = json.loads(dump)
check("listini estratti (un record per zona)", "6", str(len(dati)))
print(f"  -> rigenerata src/tests/fixtures/vettori-listini-dal-db.json ({len(dump)} byte)")

print()
print("=" * 72)
print(f"ESITO: {ok} verifiche superate, {ko} fallite")
print("=" * 72)
sys.exit(1 if ko else 0)
