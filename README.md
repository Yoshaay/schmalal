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
  --bind 127.0.0.1:8000 \
  --timeout 300 \
  app:app
```

Flask serviert `dist/index.html` auf `/` und `dist/assets/*` auf `/assets/*`.
Reverse-Proxy davor (siehe weiter unten), fertig.

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

## Reverse Proxy

LALAL akzeptiert große Audiodateien — der Reverse-Proxy muss sie durchlassen.
Wenn `SCHMALAL_MAX_BYTES` 100 MB ist, sind 200 MB im Proxy ein guter Puffer.

### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name schmalal.example.com;

    client_max_body_size 200m;

    proxy_read_timeout    300s;
    proxy_send_timeout    300s;
    proxy_connect_timeout 30s;

    proxy_request_buffering off;
    proxy_buffering         off;

    location / {
        proxy_pass         http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

### Apache 2.4

```apache
<VirtualHost *:443>
    ServerName schmalal.example.com

    LimitRequestBody 209715200      # 200 MB
    Timeout 300
    ProxyTimeout 300

    SSLEngine on
    SSLCertificateFile      /etc/letsencrypt/live/schmalal.example.com/fullchain.pem
    SSLCertificateKeyFile   /etc/letsencrypt/live/schmalal.example.com/privkey.pem

    ProxyPreserveHost On
    ProxyRequests Off
    SetEnv proxy-sendchunked 1

    ProxyPass        / http://127.0.0.1:8000/
    ProxyPassReverse / http://127.0.0.1:8000/

    RequestHeader set X-Forwarded-Proto "https"
</VirtualHost>
```

## systemd Beispiel

```ini
# /etc/systemd/system/schmalal.service
[Unit]
Description=Schmalal — LALAL stem splitter proxy
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/schmalal
EnvironmentFile=/etc/schmalal.env
ExecStart=/opt/schmalal/.venv/bin/gunicorn \
    --workers 2 --threads 4 \
    --bind 127.0.0.1:8000 --timeout 300 \
    app:app
Restart=on-failure
RestartSec=3
User=schmalal

[Install]
WantedBy=multi-user.target
```

Mit `/etc/schmalal.env`:

```
LALAL_LICENSE=dein-license-key
SCHMALAL_PIN=etwas-langes
SCHMALAL_SECRET_KEY=...64-hex-zeichen-aus-secrets.token_hex(32)...
SCHMALAL_COOKIE_SECURE=1
```

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
| GET     | `/api/healthz`             | —    | —                       | Server-Status                                            |
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
- **Upload bricht sofort ab:** Reverse-Proxy `client_max_body_size` /
  `LimitRequestBody` zu klein.
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
