"""
Trasforma il CSV dello storico Excel in SQL da applicare al database.

Perche' un file SQL invece di uno script che scrive: la produzione e' il
PostgreSQL della VM, e l'unico modo onesto di caricarci mille righe di dati
aziendali e' un file che si puo' leggere prima di eseguirlo, applicare in una
transazione sola e rieseguire senza fare danni.

    python scripts/vettori/estrai-storico-excel.py
    python scripts/vettori/storico-excel-sql.py > storico.sql
    psql -d intranet --single-transaction -f storico.sql

Quello che genera e' idempotente due volte:
  - le spedizioni entrano con ON CONFLICT DO NOTHING sulla chiave naturale
    (direzione, controparte, riferimento normalizzato, data);
  - le misure entrano solo per le spedizioni che non ne hanno ancora.

I numeri dei fogli non vengono ricalcolati. Colli, pesi e misure sono quelli
che l'amministrazione ha scritto a suo tempo: il controllo tariffario vero si
fa sulle fatture acquisite, non riaprendo il pregresso.
"""
import collections
import csv
import os
import re
import sys

CSV = os.environ.get("VETTORI_STORICO_CSV") or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "storico_spedizioni_2026.csv"
)

# Il foglio TNT-FEDEX mescola i due vettori senza una colonna che li distingua:
# quelle righe restano senza vettore, e la nota lo dichiara. Non si sceglie un
# vettore a caso per fare numero.
VETTORI = {"gls": "gls", "trading_post": "trading_post"}


def norma(v):
    """La stessa normalizzazione del portale (`normalizzaRiferimento`)."""
    if not v:
        return None
    pulito = re.sub(r"[^A-Z0-9]", "", str(v).upper())
    senza_zeri = pulito.lstrip("0")
    if not senza_zeri or re.fullmatch(r"X+", senza_zeri):
        return None
    return senza_zeri


def cita(v):
    if v is None or v == "":
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"


def num(v):
    if v is None or v == "":
        return "NULL"
    return str(float(v))


def intero(v):
    if v is None or v == "":
        return "NULL"
    return str(int(round(float(v))))


righe = list(csv.DictReader(open(CSV, encoding="utf-8"), delimiter=";"))

# ── Una spedizione per chiave naturale ──────────────────────────────────────
#
# Sulla stessa bolla i fogli portano a volte piu' righe, e non sono la stessa
# cosa:
#
#   - righe IDENTICHE in ogni campo: sono l'effetto delle celle unite, dove la
#     controparte sta solo sulla prima riga e le altre la ereditano a video.
#     Una copia non e' una spedizione in piu'.
#   - righe con pesi o colli DIVERSI: sono carichi distinti partiti con lo
#     stesso numero di bolla. Li si somma, perche' e' quello che dicono i
#     totali del foglio, e le misure restano separate gruppo per gruppo.
gruppi = collections.OrderedDict()
scartate_senza_riferimento = 0

for r in righe:
    riferimento = norma(r["numero_ddt"])
    if not riferimento:
        scartate_senza_riferimento += 1
        continue
    chiave = (r["vettore"], r["direzione"], riferimento, r["data"])
    gruppi.setdefault(chiave, []).append(r)

spedizioni = []
misure = []
aggregate = 0
copie = 0

for (vettore, direzione, riferimento, data), gruppo in gruppi.items():
    distinte = []
    viste = set()
    for r in gruppo:
        impronta = (
            r["controparte"], r["colli"], r["peso_kg"], r["lunghezza_cm"],
            r["larghezza_cm"], r["altezza_cm"], r["peso_volumetrico_kg"],
        )
        if impronta in viste:
            copie += 1
            continue
        viste.add(impronta)
        distinte.append(r)

    if len(distinte) > 1:
        aggregate += 1

    colli = sum(float(r["colli"]) for r in distinte if r["colli"]) or None
    peso = sum(float(r["peso_kg"]) for r in distinte if r["peso_kg"]) or None
    controparte = next((r["controparte"] for r in distinte if r["controparte"]), None)
    fogli = sorted({r["foglio"] for r in distinte})

    nota = "Storico Excel 2026 (" + ", ".join(fogli) + ")"
    if vettore == "tnt_fedex":
        nota += ". Il foglio non distingue TNT da FedEx: vettore non attribuito"
    if len(distinte) > 1:
        nota += f". {len(distinte)} carichi sullo stesso numero di bolla, sommati"

    spedizioni.append({
        "direzione": "entrata" if direzione == "ENTRATA" else "uscita",
        "vettore": VETTORI.get(vettore),
        "riferimento_originale": distinte[0]["numero_ddt"],
        "riferimento": riferimento,
        "data": data,
        "controparte": controparte,
        "colli": colli,
        "peso": peso,
        "nota": nota,
    })

    for r in distinte:
        l, p, h = r["lunghezza_cm"], r["larghezza_cm"], r["altezza_cm"]
        if not (l and p and h):
            continue
        if float(l) <= 0 or float(p) <= 0 or float(h) <= 0:
            continue
        quantita = max(1, int(round(float(r["colli"] or 1))))
        volume = quantita * float(l) * float(p) * float(h) / 1_000_000
        if volume <= 0:
            continue
        misure.append({
            "direzione": "entrata" if direzione == "ENTRATA" else "uscita",
            "riferimento": riferimento,
            "data": data,
            "quantita": quantita,
            "l": l, "p": p, "h": h,
            "peso": r["peso_kg"],
            "volume": round(volume, 6),
        })

print("-- Storico Excel 2026 -> vettori.spedizioni e vettori.bolla_misure")
print(f"-- Generato da {os.path.basename(__file__)} su {len(righe)} righe di foglio.")
print(f"-- {len(spedizioni)} spedizioni, {len(misure)} gruppi di misure.")
print(f"-- {copie} righe copiate dalle celle unite, {aggregate} bolle con piu' carichi sommati,")
print(f"-- {scartate_senza_riferimento} righe senza un numero di bolla utilizzabile.")
print()
print("CREATE TEMP TABLE storico_spedizioni (")
print("  direzione text, vettore_codice text, riferimento_originale text,")
print("  riferimento text, data_documento date, controparte text,")
print("  colli numeric, peso numeric, nota text")
print(") ON COMMIT DROP;")
print()

for blocco in range(0, len(spedizioni), 200):
    valori = []
    for s in spedizioni[blocco:blocco + 200]:
        valori.append(
            "(" + ", ".join([
                cita(s["direzione"]), cita(s["vettore"]), cita(s["riferimento_originale"]),
                cita(s["riferimento"]), cita(s["data"]), cita(s["controparte"]),
                num(s["colli"]), num(s["peso"]), cita(s["nota"]),
            ]) + ")"
        )
    print("INSERT INTO storico_spedizioni VALUES\n" + ",\n".join(valori) + ";")
    print()

print("""
INSERT INTO vettori.spedizioni (
  direzione, vettore_id, numero_riferimento, numero_riferimento_norm,
  data_documento, controparte_nome, colli_bolla, peso_bolla, origine, stato, note
)
SELECT
  s.direzione,
  v.id,
  s.riferimento_originale,
  s.riferimento,
  s.data_documento,
  s.controparte,
  s.colli::int,
  s.peso,
  'excel_storico',
  'attesa',
  s.nota
FROM storico_spedizioni s
LEFT JOIN vettori.vettori v ON v.codice = s.vettore_codice
ON CONFLICT DO NOTHING;
""")

print("CREATE TEMP TABLE storico_misure (")
print("  direzione text, riferimento text, data_documento date, quantita int,")
print("  l numeric, p numeric, h numeric, peso numeric, volume numeric")
print(") ON COMMIT DROP;")
print()

for blocco in range(0, len(misure), 200):
    valori = []
    for m in misure[blocco:blocco + 200]:
        valori.append(
            "(" + ", ".join([
                cita(m["direzione"]), cita(m["riferimento"]), cita(m["data"]),
                intero(m["quantita"]), num(m["l"]), num(m["p"]), num(m["h"]),
                num(m["peso"]), num(m["volume"]),
            ]) + ")"
        )
    print("INSERT INTO storico_misure VALUES\n" + ",\n".join(valori) + ";")
    print()

# Le misure si agganciano alla spedizione per chiave naturale, e solo dove non
# ce ne sono gia': ricaricare il file non deve raddoppiare i colli misurati.
# Una spedizione congelata non si tocca — glielo impedirebbe comunque il
# trigger, ma e' meglio non provarci nemmeno.
print("""
INSERT INTO vettori.bolla_misure (
  spedizione_id, quantita, lunghezza_cm, larghezza_cm, altezza_cm,
  peso_reale_kg, volume_m3, fonte
)
SELECT
  sp.id, m.quantita, m.l, m.p, m.h,
  NULLIF(m.peso, 0),
  m.volume,
  'magazzino'
FROM storico_misure m
JOIN vettori.spedizioni sp
  ON sp.numero_riferimento_norm = m.riferimento
 AND sp.data_documento = m.data_documento
 AND sp.direzione = m.direzione
 AND sp.origine = 'excel_storico'
WHERE NOT sp.congelata
  AND NOT EXISTS (
    SELECT 1 FROM vettori.bolla_misure b WHERE b.spedizione_id = sp.id
  );
""")

print("SELECT origine, count(*) FROM vettori.spedizioni GROUP BY 1 ORDER BY 1;")
print("SELECT fonte, count(*) FROM vettori.bolla_misure GROUP BY 1 ORDER BY 1;")
