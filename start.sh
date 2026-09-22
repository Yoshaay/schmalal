#!/usr/bin/env bash
# Startet das Schmalal-Backend mit Gunicorn auf 127.0.0.1:8002.
# Apache leitet /api/* dorthin weiter. Statische Files serviert Apache selbst.
#
# Für Production läuft der Dienst als systemd-Unit schmalsoft-schmalal.service
# (deploy/schmalsoft-schmalal.service) — Auto-Restart, Boot-Start, Logs in journalctl.
# Dieses Skript ist für manuelles Hochfahren / Smoke-Tests.

set -euo pipefail

cd "$(dirname "$0")"

if [ ! -x .venv/bin/gunicorn ]; then
  echo "Error: .venv/bin/gunicorn fehlt. Erst einrichten:"
  echo "  python3 -m venv .venv"
  echo "  .venv/bin/pip install -r requirements.txt"
  exit 1
fi

exec .venv/bin/gunicorn \
  --workers 2 \
  --threads 4 \
  --timeout 300 \
  --bind 127.0.0.1:8002 \
  app:app
