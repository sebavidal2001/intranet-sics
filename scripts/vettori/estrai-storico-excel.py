"""
Estrae lo storico spedizioni 2026 dai tre workbook dei corrieri in un unico CSV.

Non scrive su nessun database: produce materiale da ispezionare prima di caricare.
Ogni riga porta il foglio di origine, perché la qualita' dei fogli e' diversa.
"""
import csv, datetime, os, re, sys
import openpyxl, xlrd

BASE = os.environ.get("VETTORI_EXCEL_DIR") or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "excel_vettori", "TEST VETTORI"
)
USCITA = os.environ.get("VETTORI_STORICO_CSV") or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "storico_spedizioni_2026.csv"
)

# Lo storico e' il 2026: le righe di altri anni rimaste nei fogli si scartano
# qui, una volta, invece di doverle riconoscere a valle ogni volta.
ANNO = 2026

# (file, foglio, riga_intestazione, direzione, vettore, mappa colonne 0-based)
# "misure" assente = il foglio non riporta lunghezza/larghezza/altezza.
COMUNE = {"data": 0, "controparte": 1, "ddt": 2, "colli": 3, "peso": 4,
          "lung": 5, "larg": 6, "alt": 7, "peso_vol": 8}
GLS_ARRIVI = {"data": 0, "controparte": 1, "ddt": 2, "colli": 3, "peso": 4, "peso_vol": 6}
GLS_PARTENZE = dict(COMUNE, ft=16)
TNT_TP = dict(COMUNE, ft=13)

# Il foglio «superato» degli arrivi GLS non e' materiale vecchio da buttare: e'
# l'unica traccia di gennaio-aprile. Quello nuovo, «controllo DA FT», comincia
# il 5 maggio, e «superato» si riferisce al metodo — il controllo a preventivo
# invece che contro la fattura — non ai dati. Le due settimane in cui i fogli si
# sovrappongono non fanno doppioni: la chiave della spedizione e' la stessa, e
# chi carica la riconosce.
GLS_SUPERATO = dict(COMUNE, ft=20)

FOGLI = [
    ("GLS/2026 GLS.xlsx", "superato ARRIVI 2026", 14, "ENTRATA", "gls", GLS_SUPERATO),
    ("GLS/2026 GLS.xlsx", "ARRIVI 2026 controllo DA FT", 17, "ENTRATA", "gls", dict(GLS_ARRIVI, ft=15)),
    ("GLS/2026 GLS.xlsx", "PARTENZE e TRIANGOLAZIONI 2026", 14, "USCITA", "gls", GLS_PARTENZE),
    ("TNT-FEDEX/TNT-FEDEX 2026.xlsx", "ARRIVI TNT-FEDEX 2026", 17, "ENTRATA", "tnt_fedex", TNT_TP),
    ("TNT-FEDEX/TNT-FEDEX 2026.xlsx", "PARTENZE TNT-FEDEX 2026", 17, "USCITA", "tnt_fedex", TNT_TP),
]
FOGLI_XLS = [
    ("TRADING POST/TRADING POST2026.xls", "FORNITORI TP 2026", 17, "ENTRATA", "trading_post", TNT_TP),
    ("TRADING POST/TRADING POST2026.xls", "CLIENTI TP 2026", 17, "USCITA", "trading_post", TNT_TP),
]


def numero(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return round(float(v), 3)
    testo = str(v).strip().replace(".", "").replace(",", ".")
    try:
        return round(float(testo), 3)
    except ValueError:
        return None


def testo(v):
    if v is None:
        return None
    s = re.sub(r"\s+", " ", str(v)).strip()
    return s or None


def riga_da(valori, mappa, vettore, direzione, foglio, data):
    def prendi(chiave, conv=numero):
        i = mappa.get(chiave)
        if i is None or i >= len(valori):
            return None
        return conv(valori[i])
    return {
        "vettore": vettore,
        "direzione": direzione,
        "data": data.isoformat(),
        "controparte": prendi("controparte", testo),
        "numero_ddt": prendi("ddt", testo),
        "colli": prendi("colli"),
        "peso_kg": prendi("peso"),
        "lunghezza_cm": prendi("lung"),
        "larghezza_cm": prendi("larg"),
        "altezza_cm": prendi("alt"),
        "peso_volumetrico_kg": prendi("peso_vol"),
        "importo_fattura": prendi("ft"),
        "foglio": foglio,
    }


righe = []

for f, foglio, r0, direzione, vettore, mappa in FOGLI:
    wb = openpyxl.load_workbook(os.path.join(BASE, f), data_only=True, read_only=True)
    for valori in wb[foglio].iter_rows(min_row=r0 + 1, values_only=True):
        if not valori or not isinstance(valori[0], datetime.datetime):
            continue
        if valori[0].year != ANNO:
            continue
        righe.append(riga_da(valori, mappa, vettore, direzione, foglio, valori[0].date()))
    wb.close()

for f, foglio, r0, direzione, vettore, mappa in FOGLI_XLS:
    wb = xlrd.open_workbook(os.path.join(BASE, f))
    ws = wb.sheet_by_name(foglio)
    for i in range(r0, ws.nrows):
        cella = ws.cell(i, 0)
        if cella.ctype != xlrd.XL_CELL_DATE:
            continue
        anno, mese, giorno = xlrd.xldate_as_tuple(cella.value, wb.datemode)[:3]
        if anno != ANNO:
            continue
        valori = [ws.cell_value(i, j) for j in range(ws.ncols)]
        righe.append(riga_da(valori, mappa, vettore, direzione, foglio,
                             datetime.date(anno, mese, giorno)))

campi = ["vettore", "direzione", "data", "controparte", "numero_ddt", "colli", "peso_kg",
         "lunghezza_cm", "larghezza_cm", "altezza_cm", "peso_volumetrico_kg",
         "importo_fattura", "foglio"]
with open(USCITA, "w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=campi, delimiter=";")
    w.writeheader()
    w.writerows(righe)

# ── Referto di qualita' ────────────────────────────────────────────────────
print(f"{'FOGLIO':38} {'RIGHE':>6} {'SENZA DDT':>10} {'CON MISURE':>11} {'SENZA PESO':>11}")
for foglio in sorted({r["foglio"] for r in righe}):
    g = [r for r in righe if r["foglio"] == foglio]
    senza_ddt = sum(1 for r in g if not r["numero_ddt"])
    con_mis = sum(1 for r in g if r["lunghezza_cm"] and r["larghezza_cm"] and r["altezza_cm"])
    senza_peso = sum(1 for r in g if not r["peso_kg"])
    print(f"{foglio[:38]:38} {len(g):6} {senza_ddt:10} {con_mis:11} {senza_peso:11}")

chiavi = [(r["vettore"], r["numero_ddt"]) for r in righe if r["numero_ddt"]]
dupli = len(chiavi) - len(set(chiavi))
print(f"\nTotale righe: {len(righe)}")
print(f"Righe con numero DDT: {len(chiavi)}  |  chiavi (vettore, ddt) duplicate: {dupli}")
print(f"Periodo: {min(r['data'] for r in righe)} -> {max(r['data'] for r in righe)}")
print(f"CSV: {USCITA}")
