#!/bin/bash
#
# costi-ingest.sh — Consuma i run "costi" depositati dal receiver.
# Destinazione sulla VM: /opt/impresa-bi/costi-ingest.sh
#
# Innescato da impresa-bi-costi.path quando compare una directory in
# /var/lib/impresa-bi/ready-costi. Gemello di cruscotto-ingest.sh, con una
# differenza sostanziale: qui l'ingest è a UPSERT e non sostituisce niente.
# Il file notturno porta il solo anno corrente e la finestra di cancellazione
# si deduce da lui (`--ricarica`), quindi gli anni chiusi non si toccano.
#
# Il profilo è separato da `cruscotto` di proposito: receiver.py rifiuta il
# manifest se mancano dataset del profilo, quindi con i due dataset insieme un
# guasto dei costi bloccherebbe l'aggiornamento di preventivatore.prodotti e
# fermerebbe il Preventivatore. Un guasto per volta.

set -euo pipefail

READY_ROOT="${BI_COSTI_READY:-/var/lib/impresa-bi/ready-costi}"
PROCESSED_ROOT="${BI_COSTI_PROCESSED:-/var/lib/impresa-bi/processed-costi}"
FAILED_ROOT="${BI_COSTI_FAILED:-/var/lib/impresa-bi/failed-costi}"
INGEST_SCRIPT="${BI_COSTI_SCRIPT:-/opt/intranet-sics/scripts/bi-ingest-costi.mjs}"
LOCK_FILE="${BI_COSTI_LOCK:-/var/lib/impresa-bi/costi-ingest.lock}"

log() { printf '%s %s\n' "$(date -Is)" "$*"; }

# Un solo ingest costi per volta. -n: se un altro è in corso si esce subito,
# tanto il .path riscatterà quando la directory cambia ancora.
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "Un altro ingest costi è in corso: esco."
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
  csv="$run_dir/costi_listino_storico.csv"
  run_trovati=$((run_trovati + 1))

  if [[ ! -f "$csv" ]]; then
    log "[$run_id] CSV mancante: sposto in failed/"
    mv "$run_dir" "$FAILED_ROOT/$run_id" 2>/dev/null || true
    run_falliti=$((run_falliti + 1))
    continue
  fi

  log "[$run_id] ingest in corso"

  # --ricarica e NON --anno-da: la finestra di cancellazione esce dal file.
  # Con un parametro fisso, il 1° gennaio il file del nuovo anno avrebbe
  # cancellato tutto l'anno precedente.
  if node "$INGEST_SCRIPT" --file="$csv" --run-id="$run_id" --ricarica; then
    rm -rf "${PROCESSED_ROOT:?}/$run_id"
    mv "$run_dir" "$PROCESSED_ROOT/$run_id"
    log "[$run_id] caricato, archiviato in processed-costi/"
  else
    # Il run resta a disposizione per l'analisi: il motivo del fallimento è
    # già registrato in bi.costi_listino_ingest.messaggio.
    rm -rf "${FAILED_ROOT:?}/$run_id"
    mv "$run_dir" "$FAILED_ROOT/$run_id"
    log "[$run_id] FALLITO, spostato in failed-costi/"
    run_falliti=$((run_falliti + 1))
  fi
done

if (( run_trovati == 0 )); then
  log "Nessun run da elaborare."
fi

# Uscita diversa da zero se almeno un run è fallito: systemd lo marca failed e
# il fatto diventa visibile in `systemctl status`.
(( run_falliti == 0 )) || exit 1
