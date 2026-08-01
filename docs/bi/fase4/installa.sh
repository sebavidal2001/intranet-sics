#!/bin/bash
#
# installa.sh — Installazione della Fase 4 sulla VM Linux, in un colpo solo.
#
#   sudo bash /tmp/fase4/installa.sh --check   # diagnosi, non scrive nulla
#   sudo bash /tmp/fase4/installa.sh           # installa
#
# Ogni passo verifica il precedente: al primo problema si ferma senza lasciare
# la pipeline a metà. Il receiver viene riavviato una volta sola, alla fine
# della parte che lo riguarda, e subito ricontrollato.

set -euo pipefail

PACCHETTO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RECEIVER="/opt/impresa-bi/receiver.py"
CONFIG="/etc/impresa-bi/config.json"
ENV_SUPABASE="/etc/impresa-bi/supabase.env"
INGEST_SCRIPT="/opt/intranet-sics/scripts/bi-ingest-cruscotto.mjs"
SOLO_CHECK=0
[[ "${1:-}" == "--check" ]] && SOLO_CHECK=1

verde()  { printf '\033[32m%s\033[0m\n' "$*"; }
giallo() { printf '\033[33m%s\033[0m\n' "$*"; }
rosso()  { printf '\033[31m%s\033[0m\n' "$*"; }
passo()  { printf '\n\033[36m── %s\033[0m\n' "$*"; }
muori()  { rosso "ERRORE: $*"; rosso "Interrotto: nulla di ciò che segue è stato eseguito."; exit 1; }

[[ $EUID -eq 0 ]] || muori "servono i privilegi di root: usare sudo"

# ── Prerequisiti ────────────────────────────────────────────────────────────
passo "Prerequisiti"

[[ -f "$RECEIVER" ]]     || muori "receiver non trovato: $RECEIVER"
[[ -f "$CONFIG" ]]       || muori "configurazione non trovata: $CONFIG"
[[ -f "$ENV_SUPABASE" ]] || muori "variabili Supabase non trovate: $ENV_SUPABASE"
command -v jq   >/dev/null || muori "jq non installato: apt install -y jq"
command -v node >/dev/null || muori "node non installato"

if [[ ! -f "$INGEST_SCRIPT" ]]; then
  muori "script di ingest non trovato: $INGEST_SCRIPT
  Serve il deploy di intranet-sics aggiornato:
    ssh intra-adm@192.168.1.21 'cd /opt/intranet-sics && ./deploy.sh'"
fi
verde "  receiver, configurazione, jq, node e script di ingest presenti"

# Le variabili Supabase: si controllano i NOMI, mai i valori.
url_ok=0; key_ok=0
grep -qE '^\s*(export\s+)?(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_URL)=' "$ENV_SUPABASE" && url_ok=1
grep -qE '^\s*(export\s+)?(SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SERVICE_KEY)=' "$ENV_SUPABASE" && key_ok=1
[[ $url_ok -eq 1 ]] || muori "in $ENV_SUPABASE manca SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL)"
[[ $key_ok -eq 1 ]] || muori "in $ENV_SUPABASE manca SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_SERVICE_KEY)"
verde "  variabili Supabase presenti"

# ── Verifica della patch ────────────────────────────────────────────────────
passo "Verifica della patch al receiver"
python3 "$PACCHETTO/patch-receiver-profili.py" --file "$RECEIVER" --check \
  || muori "la patch non combacia con il receiver installato"

# ── Collaudo su copia ───────────────────────────────────────────────────────
passo "Collaudo su copia isolata"
PROVA="$(mktemp /tmp/receiver-prova-XXXXXX.py)"
cp "$RECEIVER" "$PROVA"
python3 "$PACCHETTO/patch-receiver-profili.py" --file "$PROVA" >/dev/null
python3 "$PACCHETTO/test-receiver-profili.py" --receiver "$PROVA" \
  || muori "il collaudo del receiver patchato non è passato"
rm -f "$PROVA"

if [[ $SOLO_CHECK -eq 1 ]]; then
  passo "Diagnosi completata"
  verde "Tutto pronto per l'installazione. Rieseguire senza --check."
  exit 0
fi

# ── Applicazione ────────────────────────────────────────────────────────────
passo "Patch del receiver"
python3 "$PACCHETTO/patch-receiver-profili.py" --file "$RECEIVER"

passo "Dataset cruscotto_articoli nella configurazione"
if jq -e '.datasets.cruscotto_articoli' "$CONFIG" >/dev/null 2>&1; then
  giallo "  già presente: lascio com'è"
else
  cp -a "$CONFIG" "$CONFIG.before-cruscotto-$(date +%Y%m%d-%H%M%S)"
  TMPCFG="$(mktemp)"
  jq '.datasets.cruscotto_articoli = {
        "columns": 40,
        "profile": "cruscotto",
        "header_first_field": "codice"
      }' "$CONFIG" > "$TMPCFG"
  # Un JSON troncato qui manderebbe in crash il receiver al riavvio.
  jq -e . "$TMPCFG" >/dev/null || muori "il config prodotto non è JSON valido"
  install -o root -g root -m 640 "$TMPCFG" "$CONFIG"
  rm -f "$TMPCFG"
  verde "  aggiunto"
fi
echo "  dataset configurati: $(jq -r '.datasets | keys | join(", ")' "$CONFIG")"

passo "Riavvio del receiver"
systemctl restart impresa-bi-ingest
sleep 2
PORTA="$(jq -r '.listen_port // 8765' "$CONFIG")"
if curl -sf "localhost:$PORTA/health" >/dev/null; then
  verde "  in ascolto e sano su :$PORTA"
else
  rosso "  /health non risponde. Ultime righe del log:"
  journalctl -u impresa-bi-ingest -n 20 --no-pager || true
  muori "il receiver non è ripartito correttamente"
fi

passo "Runner e unit systemd"
install -o root -g root -m 755 "$PACCHETTO/cruscotto-ingest.sh" /opt/impresa-bi/cruscotto-ingest.sh
install -o root -g root -m 644 "$PACCHETTO/impresa-bi-cruscotto.service" /etc/systemd/system/
install -o root -g root -m 644 "$PACCHETTO/impresa-bi-cruscotto.path" /etc/systemd/system/
install -d -o impresa-bi -g impresa-bi -m 750 \
  /var/lib/impresa-bi/ready-cruscotto \
  /var/lib/impresa-bi/processed-cruscotto \
  /var/lib/impresa-bi/failed-cruscotto
systemctl daemon-reload
systemctl enable --now impresa-bi-cruscotto.path
verde "  installati e attivi"

# ── Riepilogo ───────────────────────────────────────────────────────────────
passo "Stato finale"
systemctl is-active impresa-bi-ingest        | sed 's/^/  impresa-bi-ingest:        /'
systemctl is-active impresa-bi-cruscotto.path | sed 's/^/  impresa-bi-cruscotto.path: /'
systemctl is-active impresa-bi-daily.path     | sed 's/^/  impresa-bi-daily.path:     /'

passo "Fatto"
cat <<'FINE'
Il lato Linux è pronto e in attesa. Il prossimo movimento tocca al server
Windows: quando spedirà il primo run con -Profilo cruscotto, il receiver lo
depositerà in ready-cruscotto/ e l'ingest partirà da solo.

Per seguirlo:
  sudo journalctl -u impresa-bi-cruscotto -f

Per lo stato della pipeline:
  cd /opt/intranet-sics && node scripts/bi-cruscotto-stato.mjs

Rollback: vedi la sezione in README.md di questo pacchetto.
FINE
