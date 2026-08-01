#!/usr/bin/env python3
"""
Patch idempotente di /opt/impresa-bi/receiver.py — profili di run (Fase 4).

Perché serve
------------
Il receiver considera obbligatori TUTTI i dataset configurati:

    if set(by_dataset) != set(EXPECTED_DATASETS):
        ... "manifest incompleto"

Aggiungere `cruscotto_articoli` a config.json senza altro farebbe fallire ogni
completamento commerciale: il manifest delle sette query risulterebbe incompleto
perché manca il Cruscotto. E viceversa.

In più `validate_csv` riconosce l'intestazione solo se il primo campo è
"Codice Gruppo" o "gruppo_codice". La prima colonna del Cruscotto è "codice":
l'header verrebbe contato come riga dati e il conteggio del manifest non
tornerebbe mai.

Terzo punto, meno evidente ma decisivo: `impresa-bi-daily.path` e
`impresa-bi-loader.path` monitorano entrambe /var/lib/impresa-bi/ready. Un run
Cruscotto depositato lì scatenerebbe il loader commerciale e il forecast
giornaliero.

Cosa fa la patch
----------------
1. Ogni dataset può dichiarare `profile` (default "commerciale") e
   `header_first_field`.
2. `/complete` deduce il profilo dai dataset del manifest e pretende esattamente
   quelli di quel profilo. Un manifest che mescola profili viene rifiutato.
3. I run non commerciali atterrano in `ready-<profilo>/`, non in `ready/`:
   le path unit esistenti restano cieche rispetto al Cruscotto.
4. Il riconoscimento dell'intestazione diventa configurabile per dataset.

I dataset senza `profile` restano "commerciale": config.json esistente continua
a funzionare identico.

Uso
---
    sudo python3 patch-receiver-profili.py --check        # solo diagnosi
    sudo python3 patch-receiver-profili.py                # applica (con backup)
    sudo python3 patch-receiver-profili.py --restore <backup>

Non riavvia nulla: il restart del servizio è una decisione dell'operatore.
"""

from __future__ import annotations

import argparse
import ast
import datetime as dt
import shutil
import sys
from pathlib import Path

BERSAGLIO = Path("/opt/impresa-bi/receiver.py")

# (descrizione, testo da cercare, testo sostitutivo)
# Ogni sostituzione deve trovare UNA sola occorrenza: se il file è diverso da
# quello atteso la patch si ferma senza toccare niente.
SOSTITUZIONI: list[tuple[str, str, str]] = [
    (
        "regex del profilo",
        'DATASET_RE = re.compile(r"^[a-z0-9_]{1,80}$")',
        'DATASET_RE = re.compile(r"^[a-z0-9_]{1,80}$")\n'
        'PROFILE_RE = re.compile(r"^[a-z0-9_]{1,40}$")',
    ),
    (
        "validazione di profile e header_first_field",
        """        columns = definition.get("columns")
        if not isinstance(columns, int) or columns < 1:
            raise RuntimeError(f"Numero colonne non valido: {name}")
""",
        """        columns = definition.get("columns")
        if not isinstance(columns, int) or columns < 1:
            raise RuntimeError(f"Numero colonne non valido: {name}")

        # Profilo di appartenenza: separa i run commerciali da quelli del
        # Cruscotto. Assente = "commerciale", così la configurazione
        # preesistente continua a valere senza modifiche.
        profile = definition.get("profile", DEFAULT_PROFILE)
        if not isinstance(profile, str) or not PROFILE_RE.fullmatch(profile):
            raise RuntimeError(f"Profilo non valido per {name}: {profile!r}")
        definition["profile"] = profile

        # Primo campo dell'intestazione: serve a non contarla fra le righe.
        header = definition.get("header_first_field")
        if header is None:
            header = list(HEADER_FIELDS_DEFAULT)
        elif isinstance(header, str):
            header = [header]
        if not isinstance(header, list) or not all(
            isinstance(value, str) for value in header
        ):
            raise RuntimeError(f"header_first_field non valido: {name}")
        definition["header_first_field"] = header
""",
    ),
    (
        "costanti dei profili",
        """CONFIG = load_config()""",
        """DEFAULT_PROFILE = "commerciale"
HEADER_FIELDS_DEFAULT = ("Codice Gruppo", "gruppo_codice")

CONFIG = load_config()""",
    ),
    (
        "helper dei profili",
        """EXPECTED_DATASETS: dict[str, dict[str, Any]] = CONFIG["datasets"]
""",
        """EXPECTED_DATASETS: dict[str, dict[str, Any]] = CONFIG["datasets"]


def profile_of(dataset: str) -> str:
    return EXPECTED_DATASETS[dataset].get("profile", DEFAULT_PROFILE)


def datasets_for_profile(profile: str) -> set[str]:
    return {name for name in EXPECTED_DATASETS if profile_of(name) == profile}


def ready_root_for(profile: str) -> Path:
    # Il profilo commerciale conserva la directory storica: impresa-bi-daily.path
    # e impresa-bi-loader.path monitorano proprio quella, e devono continuare a
    # vedere solo i run commerciali.
    if profile == DEFAULT_PROFILE:
        return READY_ROOT
    return STORAGE_ROOT / f"ready-{profile}"
""",
    ),
    (
        "intestazione configurabile in validate_csv",
        """def validate_csv(
    path: Path, expected_columns: int, expected_rows: int
) -> None:""",
        """def validate_csv(
    path: Path,
    expected_columns: int,
    expected_rows: int,
    header_fields: list[str] | None = None,
) -> None:""",
    ),
    (
        "confronto del primo campo di intestazione",
        """                and fields[0] in {"Codice Gruppo", "gruppo_codice"}""",
        """                and fields[0] in set(header_fields or HEADER_FIELDS_DEFAULT)""",
    ),
    (
        "ready path per profilo in handle_dataset",
        """        ready_path = secure_child(READY_ROOT, run_id) / f"{dataset}.csv\"""",
        """        ready_path = (
            secure_child(ready_root_for(profile_of(dataset)), run_id)
            / f"{dataset}.csv"
        )""",
    ),
    (
        "lettura del manifest prima del controllo ready",
        """    def handle_complete(self) -> None:
        run_id = self.require_run_id()
        ready_path = secure_child(READY_ROOT, run_id)
        if ready_path.exists():
            self.send_json(
                HTTPStatus.OK,
                {"ok": True, "status": "already_complete", "run_id": run_id},
            )
            return

        length = self.content_length(1024 * 1024)""",
        """    def handle_complete(self) -> None:
        # Il manifest va letto per primo: la directory di destinazione dipende
        # dal profilo, che si conosce solo dopo aver visto i dataset dichiarati.
        run_id = self.require_run_id()
        length = self.content_length(1024 * 1024)""",
    ),
    (
        "verifica del manifest per profilo",
        """        if set(by_dataset) != set(EXPECTED_DATASETS):
            missing = sorted(set(EXPECTED_DATASETS) - set(by_dataset))
            extra = sorted(set(by_dataset) - set(EXPECTED_DATASETS))
            raise RequestError(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                f"manifest incompleto; mancanti={missing}, extra={extra}",
            )
""",
        """        ignoti = sorted(set(by_dataset) - set(EXPECTED_DATASETS))
        if ignoti:
            raise RequestError(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                f"dataset non configurati nel manifest: {ignoti}",
            )

        # Un run porta un profilo solo. Così il completamento del Cruscotto non
        # pretende i sette dataset commerciali, e quello commerciale non
        # pretende il Cruscotto.
        profiles = {profile_of(name) for name in by_dataset}
        if len(profiles) != 1:
            raise RequestError(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                f"il manifest mescola profili diversi: {sorted(profiles)}",
            )
        profile = profiles.pop()

        expected = datasets_for_profile(profile)
        if set(by_dataset) != expected:
            missing = sorted(expected - set(by_dataset))
            extra = sorted(set(by_dataset) - expected)
            raise RequestError(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                (
                    f"manifest incompleto per il profilo {profile}; "
                    f"mancanti={missing}, extra={extra}"
                ),
            )

        ready_root = ready_root_for(profile)
        ready_path = secure_child(ready_root, run_id)
        if ready_path.exists():
            self.send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "status": "already_complete",
                    "run_id": run_id,
                    "profile": profile,
                },
            )
            return
""",
    ),
    (
        "iterazione sui soli dataset del run",
        """        for dataset, definition in EXPECTED_DATASETS.items():
            item = by_dataset[dataset]""",
        """        for dataset in sorted(by_dataset):
            definition = EXPECTED_DATASETS[dataset]
            item = by_dataset[dataset]""",
    ),
    (
        "intestazione attesa passata a validate_csv",
        """            validate_csv(csv_path, columns, rows)""",
        """            validate_csv(
                csv_path, columns, rows, definition.get("header_first_field")
            )""",
    ),
    (
        "destinazione del run per profilo",
        """        READY_ROOT.mkdir(mode=0o750, parents=True, exist_ok=True)
        os.replace(run_path, ready_path)
        self.send_json(
            HTTPStatus.CREATED,
            {"ok": True, "status": "complete", "run_id": run_id},
        )""",
        """        ready_root.mkdir(mode=0o750, parents=True, exist_ok=True)
        os.replace(run_path, ready_path)
        self.send_json(
            HTTPStatus.CREATED,
            {
                "ok": True,
                "status": "complete",
                "run_id": run_id,
                "profile": profile,
            },
        )""",
    ),
    (
        "creazione delle directory di ogni profilo",
        """    INCOMING_ROOT.mkdir(mode=0o750, parents=True, exist_ok=True)
    READY_ROOT.mkdir(mode=0o750, parents=True, exist_ok=True)""",
        """    INCOMING_ROOT.mkdir(mode=0o750, parents=True, exist_ok=True)
    READY_ROOT.mkdir(mode=0o750, parents=True, exist_ok=True)
    for name in EXPECTED_DATASETS:
        ready_root_for(profile_of(name)).mkdir(
            mode=0o750, parents=True, exist_ok=True
        )""",
    ),
]

MARCATORE = "def ready_root_for(profile: str) -> Path:"


def applica(testo: str) -> str:
    for descrizione, cerca, sostituisci in SOSTITUZIONI:
        occorrenze = testo.count(cerca)
        if occorrenze != 1:
            raise SystemExit(
                f"ERRORE [{descrizione}]: attesa 1 occorrenza, trovate {occorrenze}.\n"
                "Il file non corrisponde alla versione attesa: niente è stato modificato."
            )
        testo = testo.replace(cerca, sostituisci, 1)
    return testo


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", default=str(BERSAGLIO))
    parser.add_argument("--check", action="store_true",
                        help="verifica soltanto, non scrive")
    parser.add_argument("--restore", metavar="BACKUP",
                        help="ripristina il file da un backup")
    args = parser.parse_args()

    percorso = Path(args.file)

    if args.restore:
        origine = Path(args.restore)
        if not origine.is_file():
            print(f"Backup non trovato: {origine}", file=sys.stderr)
            return 1
        shutil.copy2(origine, percorso)
        print(f"Ripristinato {percorso} da {origine}")
        return 0

    if not percorso.is_file():
        print(f"File non trovato: {percorso}", file=sys.stderr)
        return 1

    testo = percorso.read_text(encoding="utf-8")

    if MARCATORE in testo:
        print("Patch già applicata: nessuna modifica necessaria.")
        return 0

    nuovo = applica(testo)

    # Un errore di sintassi qui vale molto più di un servizio che riparte:
    # il receiver è l'unico punto d'ingresso dei dati.
    try:
        ast.parse(nuovo)
    except SyntaxError as exc:
        print(f"ERRORE: il risultato non è Python valido ({exc}).", file=sys.stderr)
        return 1

    if args.check:
        print("Verifica superata: le 13 sostituzioni combaciano e il risultato compila.")
        print("Nessuna modifica scritta (--check).")
        return 0

    marca = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = percorso.with_name(f"{percorso.name}.before-profili-{marca}")
    shutil.copy2(percorso, backup)

    provvisorio = percorso.with_name(f".{percorso.name}.nuovo")
    provvisorio.write_text(nuovo, encoding="utf-8")
    shutil.copystat(percorso, provvisorio)
    provvisorio.replace(percorso)

    print(f"Patch applicata a {percorso}")
    print(f"Backup: {backup}")
    print()
    print("Passi successivi:")
    print("  1. aggiungere cruscotto_articoli a /etc/impresa-bi/config.json")
    print("  2. systemctl restart impresa-bi-ingest")
    print("  3. curl -s localhost:8765/health")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
