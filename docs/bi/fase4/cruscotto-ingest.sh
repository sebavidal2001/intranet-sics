#!/bin/bash
#
# cruscotto-ingest.sh — Consuma i run Cruscotto depositati dal receiver.
# Destinazione: /opt/impresa-bi/cruscotto-ingest.sh
#
# Innescato da impresa-bi-cruscotto.path quando compare una directory in
# /var/lib/impresa-bi/ready-cruscotto. Per ogni run chiama l'ingest atomico su
# Supabase e archivia il risultato.
#
# Il lock è dedicato: un ingest Cruscotto non blocca la pipeline commerciale e
# viceversa. Il vero mutuo esclusione sta comunque nel database (advisory lock
# in bi.ingest_cruscotto), questo evita solo lavoro sprecato.

set -euo pipefail

READY_ROOT="${BI_CRUSCOTTO_READY:-/var/lib/impresa-bi/ready-cruscotto}"
PROCESSED_ROOT="${BI_CRUSCOTTO_PROCESSED:-/var/lib/impresa-bi/processed-cruscotto}"
FAILED_ROOT="${BI_CRUSCOTTO_FAILED:-/var/lib/impresa-bi/failed-cruscotto}"
INGEST_SCRIPT="${BI_CRUSCOTTO_SCRIPT:-/opt/intranet-sics/scripts/bi-ingest-cruscotto.mjs}"
LOCK_FILE="${BI_CRUSCOTTO_LOCK:-/var/lib/impresa-bi/cruscotto-ingest.lock}"

log() { printf '%s %s\n' "$(date -Is)" "$*"; }

# Un solo ingest Cruscotto per volta. -n: se un altro è in corso si esce subito,
# tanto il .path riscatterà quando la directory cambia ancora.
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "Un altro ingest Cruscotto è in corso: esco."
  exit 0
fi

if [[ ! -f "$INGEST_SCRIPT" ]]; then
  log "ERRORE: script di ingest non trovato ($INGEST_SCRIPT). Deploy di intranet-sics mancante?"
  exit 1
fi

mkdir -p "$READY_ROOT" "$PROCESSED_ROOT" "$FAILED_ROOT"

shopt -s nullglob
run_trovati=0
run_falliti=0

for run_dir in "$READY_ROOT"/*/; do
  run_id="$(basename "$run_dir")"
  csv="$run_dir/cruscotto_articoli.csv"
  run_trovati=$((run_trovati + 1))

  if [[ ! -f "$csv" ]]; then
    log "[$run_id] CSV mancante: sposto in failed/"
    mv "$run_dir" "$FAILED_ROOT/$run_id" 2>/dev/null || true
    run_falliti=$((run_falliti + 1))
    continue
  fi

  # Istante dell'estrazione: dal manifest se c'è, altrimenti dal file.
  captured_at=""
  if [[ -f "$run_dir/manifest.json" ]]; then
    captured_at="$(python3 -c '
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as f:
        print(json.load(f).get("completed_at", "") or "")
except Exception:
    print("")
' "$run_dir/manifest.json" 2>/dev/null || true)"
  fi
  if [[ -z "$captured_at" ]]; then
    captured_at="$(date -Is -r "$csv")"
  fi

  log "[$run_id] ingest in corso (captured_at=$captured_at)"

  if node "$INGEST_SCRIPT" --file="$csv" --run-id="$run_id" --captured-at="$captured_at"; then
    rm -rf "${PROCESSED_ROOT:?}/$run_id"
    mv "$run_dir" "$PROCESSED_ROOT/$run_id"
    log "[$run_id] pubblicato, archiviato in processed-cruscotto/"
  else
    # Il run resta a disposizione per l'analisi: il motivo del fallimento è
    # già registrato in bi.cruscotto_runs.error_message.
    rm -rf "${FAILED_ROOT:?}/$run_id"
    mv "$run_dir" "$FAILED_ROOT/$run_id"
    log "[$run_id] FALLITO, spostato in failed-cruscotto/"
    run_falliti=$((run_falliti + 1))
  fi
done

if (( run_trovati == 0 )); then
  log "Nessun run da elaborare."
fi

# Uscita diversa da zero se almeno un run è fallito: systemd lo marca failed e
# il fatto diventa visibile in `systemctl status`.
(( run_falliti == 0 )) || exit 1
