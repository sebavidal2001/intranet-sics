#!/bin/bash
#
# clienti-ingest.sh — Consuma i run "clienti" depositati dal receiver.
# Destinazione sulla VM: /opt/impresa-bi/clienti-ingest.sh
#
# Innescato da impresa-bi-clienti.path quando compare una directory in
# /var/lib/impresa-bi/ready-clienti. Gemello di acquisti-ingest.sh: stesso
# profilo separato (un guasto qui non ferma cruscotto ne' costi), ingest a
# sostituzione totale fatta da scripts/bi-ingest-clienti.mjs.

set -euo pipefail

READY_ROOT="${BI_CLIENTI_READY:-/var/lib/impresa-bi/ready-clienti}"
PROCESSED_ROOT="${BI_CLIENTI_PROCESSED:-/var/lib/impresa-bi/processed-clienti}"
FAILED_ROOT="${BI_CLIENTI_FAILED:-/var/lib/impresa-bi/failed-clienti}"
INGEST_SCRIPT="${BI_CLIENTI_SCRIPT:-/opt/intranet-sics/scripts/bi-ingest-clienti.mjs}"
# Le visite viaggiano nello stesso run (profilo "clienti", dataset "visite").
VISITE_SCRIPT="${BI_VISITE_SCRIPT:-/opt/intranet-sics/scripts/bi-ingest-visite.mjs}"
LOCK_FILE="${BI_CLIENTI_LOCK:-/var/lib/impresa-bi/clienti-ingest.lock}"

log() { printf '%s %s\n' "$(date -Is)" "$*"; }

# Un solo ingest clienti per volta. -n: se un altro è in corso si esce subito,
# tanto il .path riscatterà quando la directory cambia ancora.
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "Un altro ingest clienti è in corso: esco."
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
  csv="$run_dir/clienti_anagrafica.csv"
  run_trovati=$((run_trovati + 1))

  if [[ ! -f "$csv" ]]; then
    log "[$run_id] CSV mancante: sposto in failed/"
    mv "$run_dir" "$FAILED_ROOT/$run_id" 2>/dev/null || true
    run_falliti=$((run_falliti + 1))
    continue
  fi

  log "[$run_id] ingest in corso"

  # La finestra di ricarico esce dal file (data d'ordine minima): nessun parametro.
  esito_run=0
  node "$INGEST_SCRIPT" --file="$csv" --run-id="$run_id" || esito_run=1

  # Visite: dopo i clienti, e il loro esito pesa sul run come quello dei clienti.
  # Un run senza visite.csv (pipeline non ancora aggiornata su SRVWOA) resta valido:
  # niente da caricare, nessun errore.
  visite_csv="$run_dir/visite.csv"
  if [[ -f "$visite_csv" ]]; then
    log "[$run_id] ingest visite"
    node "$VISITE_SCRIPT" --file="$visite_csv" --run-id="$run_id" || esito_run=1
  fi

  if (( esito_run == 0 )); then
    rm -rf "${PROCESSED_ROOT:?}/$run_id"
    mv "$run_dir" "$PROCESSED_ROOT/$run_id"
    log "[$run_id] caricato, archiviato in processed-clienti/"
  else
    # Il run resta a disposizione per l'analisi: il motivo del fallimento è
    # già registrato in bi.clienti_ingest.messaggio.
    rm -rf "${FAILED_ROOT:?}/$run_id"
    mv "$run_dir" "$FAILED_ROOT/$run_id"
    log "[$run_id] FALLITO, spostato in failed-clienti/"
    run_falliti=$((run_falliti + 1))
  fi
done

if (( run_trovati == 0 )); then
  log "Nessun run da elaborare."
fi

# Uscita diversa da zero se almeno un run è fallito: systemd lo marca failed e
# il fatto diventa visibile in `systemctl status`.
(( run_falliti == 0 )) || exit 1
