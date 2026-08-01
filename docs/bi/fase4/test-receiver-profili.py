#!/usr/bin/env python3
"""
Collaudo del receiver patchato (Fase 4). Non tocca nulla di reale: avvia una
istanza isolata su una porta libera, con storage in una directory temporanea.

    python3 test-receiver-profili.py --receiver /percorso/receiver.py

Verifica che:
  1. un run commerciale finisca in ready/            (le path unit lo vedono)
  2. un run cruscotto finisca in ready-cruscotto/    (le path unit NON lo vedono)
  3. un manifest che mescola profili venga rifiutato
  4. un manifest commerciale incompleto venga rifiutato
  5. l'intestazione "codice" del Cruscotto non venga contata come riga
  6. l'intestazione commerciale continui a essere riconosciuta
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

TOKEN = "x" * 48
esiti: list[tuple[bool, str]] = []


def verifica(condizione: bool, descrizione: str) -> None:
    esiti.append((condizione, descrizione))
    print(f"  {'OK  ' if condizione else 'FALLITO'}  {descrizione}")


def porta_libera() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def posta(url: str, corpo: bytes, headers: dict[str, str]) -> tuple[int, dict]:
    richiesta = urllib.request.Request(url, data=corpo, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(richiesta, timeout=10) as risposta:
            return risposta.status, json.loads(risposta.read())
    except urllib.error.HTTPError as errore:
        return errore.code, json.loads(errore.read())


def invia_dataset(base: str, run_id: str, dataset: str, testo: str) -> tuple[int, dict]:
    corpo = testo.encode("utf-8")
    return posta(
        f"{base}/{dataset}",
        corpo,
        {
            "X-Bridge-Token": TOKEN,
            "X-Run-Id": run_id,
            "X-Dataset": dataset,
            "X-SHA256": hashlib.sha256(corpo).hexdigest(),
            "Content-Type": "text/csv",
        },
    )


def completa(base: str, run_id: str, files: list[dict]) -> tuple[int, dict]:
    manifest = {"run_id": run_id, "source": "TEST", "files": files}
    corpo = json.dumps(manifest).encode("utf-8")
    return posta(
        f"{base}/complete",
        corpo,
        {"X-Bridge-Token": TOKEN, "X-Run-Id": run_id, "Content-Type": "application/json"},
    )


def csv_commerciale(righe: int) -> str:
    testa = "Codice Gruppo;Descrizione;Valore"
    corpo = [f"G{i};Gruppo {i};{i * 10}" for i in range(1, righe + 1)]
    return "\n".join([testa, *corpo]) + "\n"


def csv_cruscotto(righe: int) -> str:
    testa = "codice;descrizione;magazzino"
    corpo = [f"ART{i};Articolo {i};1" for i in range(1, righe + 1)]
    return "\n".join([testa, *corpo]) + "\n"


def scheda(dataset: str, testo: str, righe: int, colonne: int) -> dict:
    return {
        "dataset": dataset,
        "sha256": hashlib.sha256(testo.encode("utf-8")).hexdigest(),
        "rows": righe,
        "columns": colonne,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--receiver", required=True)
    argomenti = parser.parse_args()

    radice = Path(tempfile.mkdtemp(prefix="bi-test-"))
    porta = porta_libera()
    config = radice / "config.json"
    config.write_text(json.dumps({
        "listen_host": "127.0.0.1",
        "listen_port": porta,
        "storage_root": str(radice / "storage"),
        "datasets": {
            "vendite":            {"columns": 3},
            "acquisti":           {"columns": 3},
            "cruscotto_articoli": {"columns": 3,
                                   "profile": "cruscotto",
                                   "header_first_field": "codice"},
        },
    }), encoding="utf-8")

    ambiente = {**os.environ, "BI_BRIDGE_TOKEN": TOKEN, "BI_INGEST_CONFIG": str(config)}
    processo = subprocess.Popen(
        [sys.executable, argomenti.receiver],
        env=ambiente, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    base = f"http://127.0.0.1:{porta}"

    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(f"{base}/health", timeout=1).read()
                break
            except Exception:
                if processo.poll() is not None:
                    print("Il receiver non è partito:\n" + (processo.stdout.read() or ""))
                    return 1
                time.sleep(0.1)
        else:
            print("Il receiver non risponde su /health")
            return 1

        storage = radice / "storage"
        ready = storage / "ready"
        ready_cruscotto = storage / "ready-cruscotto"

        print("\n1) Run commerciale completo")
        vendite, acquisti = csv_commerciale(4), csv_commerciale(6)
        invia_dataset(base, "RUN-COMM", "vendite", vendite)
        invia_dataset(base, "RUN-COMM", "acquisti", acquisti)
        stato, corpo = completa(base, "RUN-COMM", [
            scheda("vendite", vendite, 4, 3),
            scheda("acquisti", acquisti, 6, 3),
        ])
        verifica(stato == 201, f"accettato senza il Cruscotto (stato {stato}: {corpo})")
        verifica(corpo.get("profile") == "commerciale", "profilo riconosciuto: commerciale")
        verifica((ready / "RUN-COMM").is_dir(), "atterrato in ready/ (le path unit lo vedono)")

        print("\n2) Run Cruscotto")
        cruscotto = csv_cruscotto(5)
        invia_dataset(base, "RUN-CRUS", "cruscotto_articoli", cruscotto)
        stato, corpo = completa(base, "RUN-CRUS", [
            scheda("cruscotto_articoli", cruscotto, 5, 3),
        ])
        verifica(stato == 201, f"accettato da solo (stato {stato}: {corpo})")
        verifica(corpo.get("profile") == "cruscotto", "profilo riconosciuto: cruscotto")
        verifica((ready_cruscotto / "RUN-CRUS").is_dir(), "atterrato in ready-cruscotto/")
        verifica(not (ready / "RUN-CRUS").exists(),
                 "NON atterrato in ready/ (loader e forecast restano fermi)")

        print("\n3) Intestazione del Cruscotto")
        # 5 righe dati + 1 header: se l'header venisse contato, il manifest da 5
        # verrebbe rifiutato. Il passaggio del punto 2 lo dimostra; qui si
        # controlla il caso opposto.
        stato, corpo = completa(base, "RUN-CRUS-2", [
            scheda("cruscotto_articoli", cruscotto, 6, 3),
        ])
        invia_dataset(base, "RUN-CRUS-2", "cruscotto_articoli", cruscotto)
        stato, corpo = completa(base, "RUN-CRUS-2", [
            scheda("cruscotto_articoli", cruscotto, 6, 3),
        ])
        verifica(stato == 422 and "righe non valide" in str(corpo),
                 f"conteggio sbagliato rifiutato (stato {stato})")

        print("\n4) Manifest che mescola profili")
        invia_dataset(base, "RUN-MIX", "vendite", vendite)
        invia_dataset(base, "RUN-MIX", "cruscotto_articoli", cruscotto)
        stato, corpo = completa(base, "RUN-MIX", [
            scheda("vendite", vendite, 4, 3),
            scheda("cruscotto_articoli", cruscotto, 5, 3),
        ])
        verifica(stato == 422 and "mescola profili" in str(corpo),
                 f"rifiutato (stato {stato}: {corpo.get('error')})")

        print("\n5) Manifest commerciale incompleto")
        invia_dataset(base, "RUN-PARZ", "vendite", vendite)
        stato, corpo = completa(base, "RUN-PARZ", [scheda("vendite", vendite, 4, 3)])
        verifica(stato == 422 and "acquisti" in str(corpo),
                 f"rifiutato indicando cosa manca (stato {stato}: {corpo.get('error')})")

        print("\n6) Idempotenza")
        stato, corpo = completa(base, "RUN-CRUS", [
            scheda("cruscotto_articoli", cruscotto, 5, 3),
        ])
        verifica(stato == 200 and corpo.get("status") == "already_complete",
                 "ripetere /complete non duplica il run")

    finally:
        processo.terminate()
        try:
            processo.wait(timeout=5)
        except subprocess.TimeoutExpired:
            processo.kill()

    falliti = [d for ok, d in esiti if not ok]
    print(f"\n{'=' * 60}\n{len(esiti) - len(falliti)}/{len(esiti)} verifiche superate")
    for descrizione in falliti:
        print(f"  FALLITO: {descrizione}")
    print(f"Storage del test: {radice}")
    return 1 if falliti else 0


if __name__ == "__main__":
    raise SystemExit(main())
