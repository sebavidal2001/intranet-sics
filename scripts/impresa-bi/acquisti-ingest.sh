#!/bin/bash
#
# acquisti-ingest.sh — Consuma i run "acquisti" depositati dal receiver.
# Destinazione sulla VM: /opt/impresa-bi/acquisti-ingest.sh
#
# Innescato da impresa-bi-acquisti.path quando compare una directory in
# /var/lib/impresa-bi/ready-acquisti. Gemello di costi-ingest.sh: stesso
# profilo separato (un guasto qui non ferma cruscotto ne' costi), ingest a
# ricarico di finestra fatto da scripts/bi-ingest-acquisti.mjs.

set -euo pipefail

READY_ROOT="${BI_ACQUISTI_READY:-/var/lib/impresa-bi/ready-acquisti}"
PROCESSED_ROOT="${BI_ACQUISTI_PROCESSED:-/var/lib/impresa-bi/processed-acquisti}"
FAILED_ROOT="${BI_ACQUISTI_FAILED:-/var/lib/impresa-bi/failed-acquisti}"
INGEST_SCRIPT="${BI_ACQUISTI_SCRIPT:-/opt/intranet-sics/scripts/bi-ingest-acquisti.mjs}"
LOCK_FILE="${BI_ACQUISTI_LOCK:-/var/lib/impresa-bi/acquisti-ingest.lock}"

log() { printf '%s %s\n' "$(date -Is)" "$*"; }

# Un solo ingest acquisti per volta. -n: se un altro è in corso si esce subito,
# tanto il .path riscatterà quando la directory cambia ancora.
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "Un altro ingest acquisti è in corso: esco."
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
  csv="$run_dir/acquisti_righe.csv"
  run_trovati=$((run_trovati + 1))

  if [[ ! -f "$csv" ]]; then
    log "[$run_id] CSV mancante: sposto in failed/"
    mv "$run_dir" "$FAILED_ROOT/$run_id" 2>/dev/null || true
    run_falliti=$((run_falliti + 1))
    continue
  fi

  log "[$run_id] ingest in corso"

  # La finestra di ricarico esce dal file (data d'ordine minima): nessun parametro.
  if node "$INGEST_SCRIPT" --file="$csv" --run-id="$run_id"; then
    rm -rf "${PROCESSED_ROOT:?}/$run_id"
    mv "$run_dir" "$PROCESSED_ROOT/$run_id"
    log "[$run_id] caricato, archiviato in processed-acquisti/"
  else
    # Il run resta a disposizione per l'analisi: il motivo del fallimento è
    # già registrato in bi.acquisti_ingest.messaggio.
    rm -rf "${FAILED_ROOT:?}/$run_id"
    mv "$run_dir" "$FAILED_ROOT/$run_id"
    log "[$run_id] FALLITO, spostato in failed-acquisti/"
    run_falliti=$((run_falliti + 1))
  fi
done

if (( run_trovati == 0 )); then
  log "Nessun run da elaborare."
fi

# Uscita diversa da zero se almeno un run è fallito: systemd lo marca failed e
# il fatto diventa visibile in `systemctl status`.
(( run_falliti == 0 )) || exit 1
