#!/bin/bash
set -e
cd /opt/intranet-sics
git pull origin main
npm ci --omit=dev
npm run build
pm2 restart intranet-sics
echo "Deploy completato: $(date)"
