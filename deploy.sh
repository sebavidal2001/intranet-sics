#!/bin/bash
set -e
cd /opt/intranet-sics

# Allinea forzatamente al remoto, ignorando modifiche locali (es. chmod, fix temporanei)
git fetch origin main
git reset --hard origin/main

npm ci
npm run build
pm2 restart intranet-sics
echo "Deploy completato: $(date)"
