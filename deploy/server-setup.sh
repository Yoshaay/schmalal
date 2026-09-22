#!/usr/bin/env bash
# Richtet Schmalal auf dem Server nach der Schmalsoft Produkt-Konvention ein
# und deployt den aktuellen Stand von GitHub. Idempotent: kann beliebig oft
# laufen, auch für spätere Updates.
#
# Aufruf (als root auf dem Server):
#   curl -fsSL https://raw.githubusercontent.com/Yoshaay/schmalal/main/deploy/server-setup.sh | bash
# oder nach dem ersten Lauf einfach:
#   /var/www/schmalal.schmalgsicht.de/deploy/server-setup.sh
#
# Erwartet: eine Env-Datei mit LALAL_LICENSE etc. Beim ersten Lauf wird sie aus
# einer vorhandenen .env übernommen (OLD_ENV) oder muss vorher nach
# /etc/schmalsoft/schmalal.env gelegt werden.

set -euo pipefail

SLUG="${SLUG:-schmalal}"
DOMAIN="${DOMAIN:-schmalal.schmalgsicht.de}"
PORT="${PORT:-8002}"
REPO="${REPO:-https://github.com/Yoshaay/schmalal.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/var/www/$DOMAIN}"
ENV_FILE="/etc/schmalsoft/$SLUG.env"
DATA_DIR="/var/lib/schmalsoft-$SLUG"
UNIT="schmalsoft-$SLUG.service"
# Pfad einer alten .env, aus der die Env-Datei beim ersten Lauf übernommen wird.
OLD_ENV="${OLD_ENV:-}"

log() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "Bitte als root ausführen."
for bin in git python3 npm systemctl apache2ctl; do
  command -v "$bin" >/dev/null || die "$bin fehlt."
done

# ─── 1. User + Verzeichnisse (Regel 3, 8) ─────────────────────────────────
log "User $SLUG und Verzeichnisse"
if ! id "$SLUG" >/dev/null 2>&1; then
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$SLUG"
fi
mkdir -p "$DATA_DIR" /etc/schmalsoft "$(dirname "$APP_DIR")"
chown "$SLUG:$SLUG" "$DATA_DIR"

# ─── 2. Code holen / aktualisieren ────────────────────────────────────────
log "Code nach $APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch -q origin "$BRANCH"
  git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
else
  [ -e "$APP_DIR" ] && [ -n "$(ls -A "$APP_DIR" 2>/dev/null)" ] \
    && die "$APP_DIR existiert und ist kein Git-Checkout. Bitte wegräumen oder APP_DIR anders setzen."
  git clone -q -b "$BRANCH" "$REPO" "$APP_DIR"
fi
VERSION=$(python3 -c "import json;print(json.load(open('$APP_DIR/package.json'))['version'])")
echo "Version $VERSION ($(git -C "$APP_DIR" rev-parse --short HEAD))"

# ─── 3. Env-Datei (Regel 7) ───────────────────────────────────────────────
log "Env-Datei $ENV_FILE"
if [ ! -f "$ENV_FILE" ]; then
  SRC=""
  for cand in "$OLD_ENV" "$APP_DIR/.env" "/etc/schmalal.env"; do
    [ -n "$cand" ] && [ -f "$cand" ] && { SRC="$cand"; break; }
  done
  [ -n "$SRC" ] || die "Keine Env-Datei gefunden. Lege $ENV_FILE an (Vorlage: $APP_DIR/.env.example) oder setze OLD_ENV=/pfad/zur/alten/.env."
  install -m 640 -o root -g "$SLUG" "$SRC" "$ENV_FILE"
  echo "übernommen aus $SRC"
else
  chown "root:$SLUG" "$ENV_FILE"; chmod 640 "$ENV_FILE"
  echo "vorhanden, Rechte gesetzt"
fi
grep -q '^LALAL_LICENSE=.\+' "$ENV_FILE" || echo "WARNUNG: LALAL_LICENSE in $ENV_FILE ist leer."
grep -q '^SCHMALAL_SECRET_KEY=.\+' "$ENV_FILE" || {
  echo "SCHMALAL_SECRET_KEY fehlt, wird generiert."
  printf '\nSCHMALAL_SECRET_KEY=%s\n' "$(python3 -c 'import secrets;print(secrets.token_hex(32))')" >> "$ENV_FILE"
}
grep -q '^SCHMALAL_COOKIE_SECURE=' "$ENV_FILE" || printf 'SCHMALAL_COOKIE_SECURE=1\n' >> "$ENV_FILE"

# ─── 4. Build ─────────────────────────────────────────────────────────────
log "Python-venv + Frontend-Build"
cd "$APP_DIR"
[ -x .venv/bin/gunicorn ] || python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r requirements.txt
if [ -f package-lock.json ]; then npm ci --silent; else npm install --silent; fi
npm run build --silent
[ -f dist/index.html ] || die "npm run build hat kein dist/index.html erzeugt."
chown -R "$SLUG:$SLUG" "$APP_DIR"

# ─── 5. Alten Prozess auf dem Port beenden (screen / start.sh) ────────────
log "Alte Prozesse auf Port $PORT"
if ! systemctl is-active --quiet "$UNIT"; then
  if command -v screen >/dev/null && su -s /bin/bash -c "screen -ls" "$SLUG" 2>/dev/null | grep -qi schmalal; then
    su -s /bin/bash -c "screen -S schmalal -X quit" "$SLUG" || true
  fi
  screen -ls 2>/dev/null | grep -i schmalal | awk '{print $1}' | while read -r s; do screen -S "$s" -X quit || true; done
  PIDS=$(ss -ltnp "sport = :$PORT" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u || true)
  if [ -n "$PIDS" ]; then
    echo "beende PIDs auf :$PORT: $PIDS"
    kill $PIDS || true; sleep 2
    kill -9 $PIDS 2>/dev/null || true
  else
    echo "nichts zu tun"
  fi
fi

# ─── 6. systemd-Unit (Regel 3, 4, 5) ──────────────────────────────────────
log "systemd $UNIT"
install -m 644 "$APP_DIR/deploy/$UNIT" "/etc/systemd/system/$UNIT"
systemctl daemon-reload
systemctl enable -q "$UNIT"
systemctl restart "$UNIT"
sleep 2
systemctl is-active --quiet "$UNIT" || { journalctl -u "$UNIT" -n 30 --no-pager; die "$UNIT läuft nicht."; }

# ─── 7. Apache-vhost (Regel 1, 9) ─────────────────────────────────────────
log "Apache-vhost $DOMAIN"
SITE="/etc/apache2/sites-available/$DOMAIN.conf"
if [ ! -f "$SITE" ]; then
  install -m 644 "$APP_DIR/deploy/apache-$DOMAIN.conf" "$SITE"
  echo "vhost angelegt"
else
  echo "vhost existiert, unverändert gelassen"
  if ! grep -Eq 'ProxyPass +/(health)? +http' "$SITE" && ! grep -Eq 'ProxyPass +/ +http' "$SITE"; then
    echo "WARNUNG: $SITE proxyt weder / noch /health — der Hub erreicht /health nicht."
    echo "         Ergänzen: ProxyPass /health http://127.0.0.1:$PORT/health"
  fi
  grep -q "$DOMAIN-access.log" "$SITE" || echo "WARNUNG: $SITE hat keine eigene access.log (Regel 9)."
fi
a2enmod -q proxy proxy_http headers ssl >/dev/null 2>&1 || true
a2ensite -q "$DOMAIN" >/dev/null 2>&1 || true
apache2ctl configtest
systemctl reload apache2
if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  if command -v certbot >/dev/null; then
    certbot --apache -n --agree-tos --redirect -d "$DOMAIN" --register-unsafely-without-email \
      || echo "WARNUNG: certbot fehlgeschlagen, Zertifikat manuell holen: certbot --apache -d $DOMAIN"
  else
    echo "WARNUNG: certbot fehlt, Zertifikat manuell einrichten."
  fi
fi

# ─── 8. Prüfen ────────────────────────────────────────────────────────────
log "Health-Check"
curl -fsS "http://127.0.0.1:$PORT/health" && echo
curl -fsS -o /dev/null -w "extern https://$DOMAIN/health → HTTP %{http_code}\n" "https://$DOMAIN/health" \
  || echo "extern noch nicht erreichbar (Zertifikat/DNS?)"

log "Fertig. Im Hub-Katalog: Slug $SLUG, Domain $DOMAIN, Unit $UNIT, Port $PORT, Versionsquelle package.json."
