#!/bin/bash
#
# controllo-notturno.sh — Lancia il controllo delle campagne contro i dati di Impresa.
# Destinazione sulla VM: /opt/intranet-sics/scripts/campagne/controllo-notturno.sh
#
# Innescato da intranet-campagne-controllo.timer dopo il caricamento notturno della
# pipeline BI (01:30): i dati che il controllo legge sono quelli di quel run, quindi
# lanciarlo prima non servirebbe a niente.
#
# Chiama l'app in locale (127.0.0.1:3000, la porta non e' aperta all'esterno) con un
# token Bearer. Il token sta in un file leggibile solo dall'utente del servizio:
# mai nella riga di comando, che finirebbe nell'elenco dei processi.
#
# Codici d'uscita: 0 controllo eseguito; 1 fallito (il timer lo segna e systemd lo
# mostra in `systemctl status`); 2 configurazione mancante.

set -euo pipefail

URL="${CAMPAGNE_CONTROLLO_URL:-http://127.0.0.1:3000/api/portali/campagne/controllo}"
TOKEN_FILE="${CAMPAGNE_CONTROLLO_TOKEN_FILE:-/etc/intranet-sics/campagne-controllo.token}"

log() { printf '%s %s\n' "$(date -Is)" "$*"; }

if [[ ! -r "$TOKEN_FILE" ]]; then
  log "ERRORE: token non leggibile ($TOKEN_FILE). Vedi docs/CAMPAGNE-FASE2-INSTALLAZIONE.md."
  exit 2
fi

# -K -: la intestazione arriva da stdin, cosi' il token non compare fra gli argomenti.
RISPOSTA="$(mktemp)"
trap 'rm -f "$RISPOSTA"' EXIT

CODICE="$(
  printf 'header = "Authorization: Bearer %s"\n' "$(tr -d '\r\n' < "$TOKEN_FILE")" |
    curl --silent --show-error --max-time 180 -K - \
      --request POST --output "$RISPOSTA" --write-out '%{http_code}' "$URL"
)"

case "$CODICE" in
  200)
    log "Controllo eseguito: $(tr -d '\n' < "$RISPOSTA")"
    ;;
  409)
    # Un altro controllo e' in corso (per esempio manuale): non e' un guasto.
    log "Controllo gia' in corso: nessuna azione. $(tr -d '\n' < "$RISPOSTA")"
    ;;
  401|503)
    log "ERRORE $CODICE: token rifiutato o non configurato sull'app. $(tr -d '\n' < "$RISPOSTA")"
    exit 2
    ;;
  *)
    log "ERRORE $CODICE: $(tr -d '\n' < "$RISPOSTA")"
    exit 1
    ;;
esac
