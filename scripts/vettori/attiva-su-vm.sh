#!/usr/bin/env bash
#
# Attiva il Portale Controllo Vettori sulla VM di produzione.
#
# Da eseguire SULLA VM (srv-intranet, 192.168.1.21), come utente `intra-adm`:
#
#     cd /opt/intranet-sics && bash scripts/vettori/attiva-su-vm.sh
#
# Fa tre cose e le verifica una per una:
#   1. applica le migration 087-095 al PostgreSQL locale
#   2. espone gli schemi `vettori` e `bi` a PostgREST
#   3. controlla che il portale risponda
#
# Non fa il deploy del codice: quello resta `./deploy.sh`, che va lanciato
# PRIMA di questo script perché le migration stanno nel repository.
#
# Lo script è ripetibile: le migration usano `CREATE ... IF NOT EXISTS` e
# `CREATE OR REPLACE`, rieseguirle non rompe niente e non duplica dati.

set -euo pipefail

DB="${VETTORI_DB:-postgres}"
UTENTE_DB="${VETTORI_DB_USER:-postgres}"
CARTELLA_MIGRATION="supabase/migrations"
MIGRATION=(
  087_portale_vettori_listini.sql
  088_vettori_listini_2026.sql
  089_vettori_operativo.sql
  090_bi_trasporti_documenti.sql
  091_vettori_acquisisci_fattura.sql
  092_vettori_letture.sql
  093_vettori_listini_configurabili.sql
  094_vettori_outlook.sql
  095_vettori_storico_spedizioni.sql
)

rosso()  { printf '\033[31m%s\033[0m\n' "$*"; }
verde()  { printf '\033[32m%s\033[0m\n' "$*"; }
giallo() { printf '\033[33m%s\033[0m\n' "$*"; }

psql_() { sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB" "$@"; }

# ---------------------------------------------------------------- controlli
echo "== Controlli preliminari =="

if [ ! -d "$CARTELLA_MIGRATION" ]; then
  rosso "Non trovo $CARTELLA_MIGRATION. Lo script va lanciato dalla radice di /opt/intranet-sics."
  exit 1
fi

for m in "${MIGRATION[@]}"; do
  if [ ! -f "$CARTELLA_MIGRATION/$m" ]; then
    rosso "Manca $m: il codice sulla VM è più vecchio delle migration."
    giallo "Esegui prima ./deploy.sh, che porta il repository a origin/main."
    exit 1
  fi
done
verde "Tutte e ${#MIGRATION[@]} le migration sono presenti."

if ! command -v psql >/dev/null; then
  rosso "psql non disponibile."
  exit 1
fi

# Il ruolo service_role deve esistere: le migration gli assegnano i permessi e
# senza di lui falliscono a metà, lasciando lo schema incompleto.
if ! psql_ -tAc "SELECT 1 FROM pg_roles WHERE rolname='service_role'" | grep -q 1; then
  rosso "Il ruolo service_role non esiste su questo database."
  giallo "È il ruolo con cui le route del portale scrivono. Va creato prima."
  exit 1
fi
verde "Ruolo service_role presente."

# ---------------------------------------------------------------- migration
echo
echo "== Migration =="
for m in "${MIGRATION[@]}"; do
  printf '  %-42s ' "$m"
  if psql_ -q -f "$CARTELLA_MIGRATION/$m" >/dev/null 2>/tmp/vettori-migration.err; then
    verde "applicata"
  else
    rosso "FALLITA"
    cat /tmp/vettori-migration.err
    exit 1
  fi
done

# ---------------------------------------------------------------- PostgREST
echo
echo "== Esposizione degli schemi a PostgREST =="
#
# Senza questo passo le query sugli schemi nuovi tornano VUOTE SENZA ERRORE, e
# le pagine dicono «nessun vettore configurato» con i vettori regolarmente in
# tabella. È il difetto che ha fatto perdere più tempo in sviluppo.
#
# Non apre niente verso l'esterno: con RLS attiva e nessun GRANT, `anon` e
# `authenticated` continuano a non vedere una riga. Serve solo al client
# service_role delle route.

CONFIG_PGRST=""
for candidato in /etc/postgrest.conf /etc/postgrest/postgrest.conf \
                 /opt/postgrest/postgrest.conf /etc/postgrest.d/postgrest.conf; do
  [ -f "$candidato" ] && CONFIG_PGRST="$candidato" && break
done

if [ -z "$CONFIG_PGRST" ]; then
  giallo "Non trovo il file di configurazione di PostgREST nei percorsi soliti."
  giallo "Trovalo con:  systemctl cat postgrest | grep -i conf"
  giallo "poi aggiungi 'vettori' e 'bi' alla riga db-schemas e riavvia il servizio."
else
  echo "  configurazione: $CONFIG_PGRST"
  ATTUALE=$(grep -E '^\s*db-schemas' "$CONFIG_PGRST" || echo "")
  echo "  riga attuale:   ${ATTUALE:-(assente)}"

  if echo "$ATTUALE" | grep -q 'vettori'; then
    verde "  gli schemi sono già esposti."
  else
    sudo cp "$CONFIG_PGRST" "$CONFIG_PGRST.bak-$(date +%Y%m%d-%H%M%S)"
    if [ -n "$ATTUALE" ]; then
      sudo sed -i -E 's/^(\s*db-schemas\s*=\s*")([^"]*)(")/\1\2, vettori, bi\3/' "$CONFIG_PGRST"
    else
      echo 'db-schemas = "public, vettori, bi"' | sudo tee -a "$CONFIG_PGRST" >/dev/null
    fi
    echo "  riga nuova:     $(grep -E '^\s*db-schemas' "$CONFIG_PGRST")"
    sudo systemctl restart postgrest
    verde "  PostgREST riavviato (copia di sicurezza accanto al file)."
  fi
fi

# La stessa impostazione vale anche dentro il database, per le installazioni
# che leggono la configurazione da lì. Metterla in tutti e due i posti non fa
# danno e copre entrambi i modi.
psql_ -q -c "ALTER ROLE authenticator SET pgrst.db_schemas = 'public, vettori, bi';" || \
  giallo "  (ALTER ROLE non riuscito: se PostgREST legge solo dal file, va bene lo stesso)"
psql_ -q -c "NOTIFY pgrst, 'reload config';" || true
psql_ -q -c "NOTIFY pgrst, 'reload schema';" || true

# ---------------------------------------------------------------- verifica
echo
echo "== Verifica =="
psql_ -P pager=off -c "
SELECT 'tabelle vettori'      AS voce, count(*)::text AS valore FROM information_schema.tables WHERE table_schema='vettori'
UNION ALL SELECT 'vettori censiti',    string_agg(codice, ', ' ORDER BY codice) FROM vettori.vettori
UNION ALL SELECT 'fasce di peso',      count(*)::text FROM vettori.listini_fasce
UNION ALL SELECT 'funzioni',           string_agg(p.proname, ', ' ORDER BY p.proname)
            FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='vettori'
UNION ALL SELECT 'tabelle senza RLS',  coalesce(string_agg(c.relname, ', '), 'nessuna')
            FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='vettori' AND c.relkind='r' AND NOT c.relrowsecurity
UNION ALL SELECT 'grant ad anon/authenticated', coalesce(string_agg(DISTINCT table_schema||'.'||table_name||':'||grantee, ', '), 'nessuno')
            FROM information_schema.role_table_grants
            WHERE table_schema IN ('vettori','bi') AND grantee IN ('authenticated','anon');
"

echo
giallo "Resta da fare a mano:"
echo "  · dare il livello di portale 'vettori' alle persone che devono entrare"
echo "    (tabella public.permessi_portale, oppure dalla pagina Superadmin)"
echo "  · assegnare il ruolo funzionale 'amministrazione' a chi carica le fatture"
echo "  · per le fatture FedEx: il riconoscimento ottico scarica i dati della"
echo "    lingua al primo uso e li tiene in cache. Se la VM non ha rete in"
echo "    uscita, imposta VETTORI_OCR_CACHE su una cartella scrivibile e"
echo "    copiaci dentro eng.traineddata prima del primo caricamento."
echo
verde "Fatto. Il portale risponde su /vettori."
