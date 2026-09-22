# Schmalal

Web-Tool, das die [LALAL.AI v1 API](https://www.lalal.ai/api/v1/docs/) für
Stem-Splitting fronted. Ein Track rein, Vocals/Drums/Bass/etc raus, mit
Browser-Playback. License-Key bleibt server-seitig in `LALAL_LICENSE`.

- **Backend:** Flask + Flask-Limiter, schlanker Proxy zu LALAL v1
- **Frontend:** React 18 + Vite. Production-Bundle ~55 kB gzip.
- **Public-tauglich:** Rhythmus-Gate (Klavier-Login mit Bayern-3-Sound-Logo)
  oder klassisches Passwort, Per-IP-Rate-Limit, Upload-Cap +
  Audio-Längen-Cap, freundliche Fehlermeldungen.

## Projektstruktur

```
schmalal/
├── app.py                # Flask-Proxy + Auth + Rate-Limit
├── requirements.txt
├── package.json          # vite + react
├── vite.config.js        # proxy /api → :5000 im Dev
├── index.html            # Vite-Entry
├── src/
│   ├── main.jsx          # ReactDOM.createRoot
│   ├── Root.jsx          # Auth-Gate-Dispatcher (Rhythm ↔ Login ↔ App)
│   ├── App.jsx           # Single-Track-State-Machine
│   ├── KeyboardView.jsx  # Klavier-Login (Bayern-3-Sound-Logo)
│   ├── PinView.jsx       # 4-stelliger PIN als Fallback (Telefon-Tastatur + DTMF)
│   ├── synth.js          # Web-Audio-Piano + DTMF-Tones + Sounds
│   ├── tokens.js         # Tokens / Stems / Helpers
│   ├── api.js            # /api/* Wrapper, ApiError-Klasse
│   ├── audio.js          # useStemPlayer-Hook
│   ├── components.jsx    # Logo, Pill, Button, Waveform, Spinner …
│   ├── views.jsx         # Idle / Uploading / Processing / Result / Error
│   └── schmalal.css      # globals + @keyframes
├── deploy/
│   ├── schmalsoft-schmalal.service          # systemd-Unit (Hub-Konvention §3)
│   └── apache-schmalal.schmalgsicht.de.conf # Apache-vhost (Hub-Konvention §4)
├── start.sh              # manueller Gunicorn-Start für Smoke-Tests
└── dist/                 # ← `npm run build`-Output, gitignored
```

## Lokale Entwicklung

Env-Variablen kommen aus `.env`. Beim ersten Klonen:

```bash
cp .env.example .env
python3 -c 'import secrets; print(f"SCHMALAL_SECRET_KEY={secrets.token_hex(32)}")' >> .env
# dann LALAL_LICENSE und ggf. SCHMALAL_PIN in .env eintragen
```

`.env` ist in `.gitignore`, der Inhalt landet nicht im Repo. `app.py` lädt sie
beim Start via `python-dotenv`.

Zwei Terminals — Frontend mit HMR auf 5173, Backend auf 5000:

```bash
# Terminal 1: Backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python app.py                          # → http://127.0.0.1:5000

# Terminal 2: Frontend
npm install
npm run dev                            # → http://127.0.0.1:5173
```

Im Browser **5173** öffnen, nicht 5000 — Vite proxied `/api/*` zu Flask, du
kriegst HMR + Source-Maps.

## Production-Build & Deploy

```bash
npm install
npm run build                          # erzeugt dist/

source .venv/bin/activate
gunicorn \
  --workers 2 --threads 4 \
  --bind 127.0.0.1:8002 \
  --timeout 300 \
  app:app
```

Flask serviert `dist/index.html` auf `/` und `dist/assets/*` auf `/assets/*`.
Apache davor (siehe [Deploy nach Schmalsoft-Konvention](#deploy-nach-schmalsoft-konvention)),
fertig. `curl http://127.0.0.1:8002/health` muss `"status":"ok"` liefern.

## Env-Variablen

| Variable                    | Default      | Beschreibung                                              |
|-----------------------------|--------------|-----------------------------------------------------------|
| `LALAL_LICENSE`             | (leer)       | **Pflicht** — LALAL v1 License-Key                        |
| `SCHMALAL_RHYTHM_INTERVALS` | (leer)       | Komma-separierte Halbton-Intervalle für das Klavier-Gate. Default in `.env.example`: `-2,7` (Bayern 3 Sound-Logo D-C-G). Wir prüfen nur die Diffs — D♯-C♯-G♯ und E-D-A funktionieren also auch. Leer = Klavier-Gate aus. |
| `SCHMALAL_PIN`              | (leer)       | 4-stelliger Zahlencode als Fallback-Gate. Muss exakt 4 Ziffern sein, alles andere wird beim Start verworfen. Wenn auch das Rhythm-Gate aktiv ist, zeigt das Frontend das Klavier mit „Code statt Klavier"-Link. |
| `SCHMALAL_SECRET_KEY`       | autogen      | Flask-Session-Signierung. **In Prod setzen**, sonst werden Sessions bei jedem Restart invalidiert |
| `SCHMALAL_MAX_BYTES`        | `104857600`  | Upload-Cap in Bytes (Default 100 MB)                      |
| `SCHMALAL_MAX_DURATION_SEC` | `600`        | Audio-Längen-Cap in Sekunden (Default 10 min) — wird nach Upload via LALAL-Metadaten geprüft, zu lange Files werden direkt wieder gelöscht |
| `SCHMALAL_RL_UPLOAD`        | `20 per hour`    | Rate-Limit für `/api/upload`   |
| `SCHMALAL_RL_SPLIT`         | `10 per hour`    | Rate-Limit für `/api/split`    |
| `SCHMALAL_RL_CHECK`         | `240 per minute` | Rate-Limit für `/api/check` (Polling)   |
| `SCHMALAL_RL_DOWNLOAD`      | `120 per hour`   | Rate-Limit für `/api/download` |
| `SCHMALAL_RL_AUTH`          | `10 per minute`  | Brute-Force-Schutz für `/api/auth` |
| `SCHMALAL_COOKIE_SECURE`    | unset            | Auf `1` setzen, wenn nur HTTPS — markiert Session-Cookie als `Secure` |
| `APP_VERSION`               | aus `package.json` | Überschreibt die in `/health` gemeldete Version (z.B. Build-Kennung, max 60 Zeichen) |
| `SCHMALAL_UPSTREAM_ERROR_WINDOW_SEC` | `300`   | Wie lange nach einem LALAL-Verbindungs-/5xx-Fehler `/health` den Check `lalal` als `degraded` meldet |

Rate-Limits gelten **pro IP**. Wenn du hinter einem Reverse-Proxy bist, achte
darauf, dass `X-Forwarded-For` ankommt (die Beispiel-Configs unten machen das).

Limits können in beliebigem Flask-Limiter-Format gesetzt werden, z.B.
`"5 per minute;50 per hour"`.

## Achtung: API v0 vs. v1

Schmalal sprach ursprünglich die deprecated v0 (Authorization-Header,
`/api/upload/`, `filter`, `enhanced_processing_enabled`, `stem: drums`,
`/api/cancel/`). Aktuell läuft alles über v1. Mapping:

| v0 (alt)                      | v1 (verwendet)                                      |
|-------------------------------|------------------------------------------------------|
| `Authorization: license …`    | `X-License-Key: …`                                  |
| `/api/upload/`                | `/api/v1/upload/`                                   |
| `/api/split/` (eine URL)      | `/voice_clean/`, `/demuser/`, `/stem_separator/`    |
| Form-encoded `params=[…]`     | JSON `{source_id, presets:{…}}`                     |
| `filter: 0/1/2`               | `extraction_level: deep_extraction / clear_cut`     |
| `enhanced_processing_enabled` | (gibt's nicht mehr; closest: `dereverb_enabled`)    |
| `stem: drums`                 | `stem: drum`                                        |
| `GET /api/check/?id=`         | `POST /api/check/` mit `{task_ids:[…]}`             |
| `POST /api/cancel/`           | nicht dokumentiert — wir mappen auf `/delete/`      |

Die proxierten URLs (`/api/upload`, `/api/split`, `/api/check?id=`,
`/api/cancel`, `/api/download`) sehen aus wie v0, intern wird auf v1
übersetzt.

### Stem-Count-Flow

Das Frontend hat 2/4/5-Stems-Auswahl. Dahinter:

| UI       | LALAL-Tasks                                 | Anzeige                                          |
|----------|---------------------------------------------|--------------------------------------------------|
| 2 stems  | 1 Task (`stem=vocals`)                      | Vocals + Instrumental (back_track des Vocals-Splits) |
| 4 stems  | 4 parallele Tasks (vocals/drum/bass/piano)  | je der Stem-Track aus jedem Task                 |
| 5 stems  | 5 parallele Tasks (+ synthesizer)           | wie 4 plus Synth                                 |

Alle Tasks parallel, gepollt mit einem `POST /api/v1/check/`-Aufruf alle
2,5 s. Splitter ist `auto`, Extraction-Level `deep_extraction`. Wer's mehr
will: in `app.py` der Defaults oder im Frontend Custom-Form ergänzen.

## Deploy nach Schmalsoft-Konvention

Schmalal folgt der [Schmalsoft Produkt-Konvention](https://hub.schmalgsicht.de/docs/produkt-konvention.md)
(Version 1, 2026-09-22), damit der Hub den Dienst ohne Sonderbehandlung
überwacht. Die Vorlagen liegen in `deploy/`.

| Regel | Umsetzung in Schmalal |
|---|---|
| 1 Subdomain + Zertifikat | `schmalal.schmalgsicht.de`, `certbot --apache` |
| 2 `GET /health` | siehe [Health-Endpunkt](#health-endpunkt) |
| 3 systemd-Unit | `deploy/schmalsoft-schmalal.service`, User `schmalal` |
| 4 Logs auf stdout/stderr | Flask-Logging und Gunicorn schreiben nach stderr → Journal |
| 5 nur `127.0.0.1:<port>` | Gunicorn bindet `127.0.0.1:8002` |
| 6 Version | aus `package.json`, in `/health` ausgegeben (Override: `APP_VERSION`) |
| 7 `.env` außerhalb des Repos, `600` | `/etc/schmalsoft/schmalal.env` via `EnvironmentFile` |
| 8 Daten unter `/var/lib/schmalsoft-schmalal/` | Schmalal hält keine Nutzerdaten auf Platte (alles wird zu LALAL gestreamt); Verzeichnis ist in der Unit trotzdem freigegeben |
| 9 Eigene Apache-Logs | `deploy/apache-schmalal.schmalgsicht.de.conf` |
| 10 Hub-Beacon | in `index.html`, `data-service="schmalal"` |

### Einrichten auf dem Server

```bash
# als root
useradd --system --home-dir /var/www/schmalal.schmalgsicht.de --shell /usr/sbin/nologin schmalal
mkdir -p /var/lib/schmalsoft-schmalal /etc/schmalsoft
chown schmalal:schmalal /var/lib/schmalsoft-schmalal

# Code nach /var/www/schmalal.schmalgsicht.de, dann dort:
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
npm install && npm run build
chown -R schmalal:schmalal /var/www/schmalal.schmalgsicht.de

# Env-Datei (Inhalt wie .env.example, mit echten Werten)
install -m 640 -o root -g schmalal .env /etc/schmalsoft/schmalal.env

# systemd
cp deploy/schmalsoft-schmalal.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now schmalsoft-schmalal.service
journalctl -u schmalsoft-schmalal -n 20

# Apache
cp deploy/apache-schmalal.schmalgsicht.de.conf /etc/apache2/sites-available/schmalal.schmalgsicht.de.conf
a2ensite schmalal.schmalgsicht.de && systemctl reload apache2
certbot --apache -d schmalal.schmalgsicht.de

# Prüfen
curl -s http://127.0.0.1:8002/health
systemctl restart schmalsoft-schmalal && systemctl status schmalsoft-schmalal
```

Zum Schluss im Hub-Katalog eintragen: Slug `schmalal`, Domain
`schmalal.schmalgsicht.de`, Health-URL `https://schmalal.schmalgsicht.de/health`,
Laufzeitart `systemd`, Unit `schmalsoft-schmalal.service`, Port `8002`,
Versionsquelle `package.json`.

Migration von `screen`/`start.sh`: alten Prozess beenden, Unit wie oben
starten. `start.sh` bleibt für manuelle Smoke-Tests.

**Stand auf schmalgsicht.de (seit 2026-09-22):** läuft so. Der vhost liegt
dort nicht als eigene Datei, sondern als Block in
`/etc/apache2/sites-enabled/schmalgsicht.de-le-ssl.conf` (echte Datei, kein
Symlink) mit `DocumentRoot …/dist`, Proxy für `/api/` und `/health`.
Updates: `deploy/server-setup.sh` mit `SKIP_APACHE=1` ausführen.

### Apache-Details

LALAL akzeptiert große Audiodateien — der Proxy muss sie durchlassen. Wenn
`SCHMALAL_MAX_BYTES` 100 MB ist, sind 200 MB (`LimitRequestBody 209715200`)
ein guter Puffer, außerdem `Timeout 300` und `ProxyTimeout 300`. Die vhost-
Vorlage setzt das im `:80`-Block; certbot legt den `:443`-Block an, dort die
gleichen drei Zeilen ergänzen. Rate-Limits gelten pro IP, daher muss
`X-Forwarded-For` ankommen (`ProxyPreserveHost On` + mod_proxy machen das).

**Achtung beim Umbau eines bestehenden vhosts:** wenn Apache bisher nur
`/api/*` an Gunicorn weiterreicht und `dist/` selbst ausliefert, erreicht
`GET /health` Flask nicht (Apache antwortet 404, der Hub sieht keinen
Health-Status). Entweder wie in der Vorlage alles auf `/` proxyen, oder
zusätzlich `ProxyPass /health http://127.0.0.1:8002/health` eintragen.

## Health-Endpunkt

`GET /health` — ohne Auth, ohne Rate-Limit, `Cache-Control: no-store`,
antwortet in Millisekunden. `/api/healthz` ist ein Alias für bestehende Checks.

```json
{
  "status": "ok",
  "service": "schmalal",
  "version": "0.2.0",
  "uptime": 86400,
  "checks": {
    "license": "ok",
    "frontend": "ok",
    "auth_gate": "ok",
    "lalal": "ok"
  },
  "time": "2026-09-22T17:00:00Z"
}
```

| Check | `ok` | `degraded` | `error` |
|---|---|---|---|
| `license` | `LALAL_LICENSE` gesetzt | — | fehlt → jeder API-Call scheitert |
| `frontend` | `dist/index.html` vorhanden | — | fehlt → `/` liefert 503 |
| `auth_gate` | Rhythm- oder PIN-Gate aktiv | kein Gate → Instanz offen | — |
| `lalal` | letzter echter LALAL-Call ok | Verbindungsfehler oder 5xx innerhalb `SCHMALAL_UPSTREAM_ERROR_WINDOW_SEC` | — |

`status` ist `error` (HTTP 503), sobald ein Check `error` ist, sonst
`degraded`, sobald einer `degraded` ist, sonst `ok`. Der `lalal`-Check probt
LALAL **nicht** aktiv (der Hub fragt alle 30 s), sondern wertet die letzten
echten Upload/Split/Check-Aufrufe aus. Ein frisch gestarteter Prozess meldet
daher `ok`, bis ein Nutzer einen Fehler auslöst.

## Auth-Gates im Detail

**Klavier (Rhythmus-Gate)**: User tippt 3 Tasten auf einem One-Octave-Klavier
(C-C). Das Backend hat den Pattern als Halbton-Intervalle (Default `-2,7` =
D-C-G, das Bayern-3-Sound-Logo). Da nur Intervalle verglichen werden, kann der
User in jeder Tonart spielen — D-C-G, D♯-C♯-G♯, E-D-A geben alle den gleichen
Diff `[-2, +7]`.

Computer-Tastatur funktioniert auch: A-S-D-F-G-H-J-K = C-D-E-F-G-A-B-C, mit
W-E-T-Y-U als schwarze Tasten dazwischen.

Pattern in `SCHMALAL_RHYTHM_INTERVALS` ändern:
- Tagesschau-Logo (G-G-A-G): Intervalle `0,2,-2` (4 Noten)
- 5-Note Spencer-Davis-Riff: such dir was aus

**PIN-Gate**: 4-stelliger Zahlencode in `SCHMALAL_PIN=3333`. Frontend zeigt
eine Telefon-Tastatur mit DTMF-Tönen pro Tastendruck. Wenn beide Gates aktiv
sind, hat das Klavier einen kleinen „Code statt Klavier"-Link für User die
mit Rhythmus nicht klarkommen — und umgekehrt im PIN-View ein „Klavier statt
Code →".

`POST /api/auth` nimmt entweder `{notes:[60,62,67]}` oder `{pin:"3333"}`
entgegen und setzt bei Erfolg ein `Set-Cookie: session=…`. Beide Pfade laufen
über das gleiche Rate-Limit (`SCHMALAL_RL_AUTH`, Default 10/min) — also kein
Brute-Force-Bypass.

## Endpoint-Übersicht

| Methode | Pfad                       | Auth | Rate-Limit              | Verhalten                                                |
|---------|----------------------------|------|-------------------------|----------------------------------------------------------|
| GET     | `/`                        | —    | —                       | Vite `dist/index.html`                                   |
| GET     | `/assets/*`                | —    | —                       | Vite-Build-Assets                                        |
| GET     | `/health`                  | —    | —                       | Hub-Health-JSON (`status`, `service`, `version`, `checks`) |
| GET     | `/api/healthz`             | —    | —                       | Alias für `/health`                                      |
| GET     | `/api/me`                  | —    | —                       | Auth-Status + welche Gates konfiguriert sind             |
| POST    | `/api/auth`                | —    | `RL_AUTH`               | `{notes:[60,62,67]}` oder `{pin:"3333"}`                 |
| POST    | `/api/logout`              | —    | —                       | session.clear()                                          |
| POST    | `/api/upload`              | ✓    | `RL_UPLOAD` + `MAX_BYTES` + `MAX_DURATION_SEC` | Multipart `file` → LALAL `/api/v1/upload/`             |
| POST    | `/api/split`               | ✓    | `RL_SPLIT`              | JSON `{jobs:[…]}` → routet auf passende v1-URL          |
| GET     | `/api/check?id=t1,t2,…`    | ✓    | `RL_CHECK`              | proxied auf `POST /api/v1/check/`, Antwort `{tasks:{…}}`|
| POST    | `/api/cancel`              | ✓    | —                       | JSON `{source_id}` → `POST /api/v1/delete/`             |
| GET     | `/api/download?url=&filename=` | ✓ | `RL_DOWNLOAD`         | Streamt von `*.lalal.ai`, mit Range-Support für `<audio>`|

## Bekannte Stolpersteine

- **Frontend leer + 503 mit „Frontend not built":** `npm run build` vergessen.
- **Upload bricht sofort ab:** Apache `LimitRequestBody` zu klein.
- **Hub zeigt `degraded` mit `auth_gate`:** weder `SCHMALAL_RHYTHM_INTERVALS`
  noch `SCHMALAL_PIN` gesetzt — Instanz ist öffentlich.
- **Hub zeigt `error` mit `frontend`:** `npm run build` auf dem Server vergessen.
- **Upload bricht nach ~30s ab:** Gunicorn-Timeout zu niedrig (Default 30s).
  `--timeout 300`.
- **„auth required" trotz korrektem Code:** entweder `SCHMALAL_SECRET_KEY`
  fehlt (Sessions invalidieren bei Restart) oder Cookie geht nicht durch
  (Reverse-Proxy schluckt `Set-Cookie`, oder `SCHMALAL_COOKIE_SECURE=1` ist
  gesetzt aber kein HTTPS).
- **HTTP 401/403 von LALAL:** Key falsch, abgelaufen oder ohne API-Quota.
- **„LALAL-Credits aufgebraucht":** das ist die einzige Fehlermeldung, bei der
  du wirklich Geld in die Hand nehmen musst.
- **Rate-Limit pro IP zu lasch/streng:** über die `SCHMALAL_RL_*`-Env-Vars
  anpassen, kein Code-Edit nötig.
