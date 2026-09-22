"""Schmalal — thin Flask proxy in front of the LALAL.AI v1 API.

Serves a Vite-built React frontend from `dist/`. License key stays on the server.
Optional shared-password gate, per-IP rate limits, and upload-size + duration caps
make this safe(-ish) to expose publicly.
"""

import hmac
import json
import logging
import mimetypes
import os
import re
import secrets
import threading
import time
from collections import defaultdict
from email.message import EmailMessage
from urllib.parse import quote, urlparse

# Load .env (if present) before reading any os.environ vars below.
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import requests
from flask import (
    Flask, Response, abort, jsonify, request, send_from_directory, session,
    stream_with_context,
)
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

# ─── Config ────────────────────────────────────────────────────────────────
HERE = os.path.dirname(os.path.abspath(__file__))
LALAL_BASE = "https://www.lalal.ai/api/v1"

# Schmalsoft Hub conventions: service slug + version (rule 2/6). Version comes
# from package.json next to this file so the Hub's fallback probe and /health
# agree; APP_VERSION in env overrides it (e.g. for a build identifier).
SERVICE_SLUG = "schmalal"
STARTED_AT = time.time()


def _read_version() -> str:
    env_v = (os.environ.get("APP_VERSION") or "").strip()
    if env_v:
        return env_v[:60]
    try:
        with open(os.path.join(HERE, "package.json"), encoding="utf-8") as fh:
            return str(json.load(fh).get("version") or "0.0.0")[:60]
    except (OSError, ValueError):
        return "0.0.0"


VERSION = _read_version()
LICENSE = (os.environ.get("LALAL_LICENSE") or "").strip()
# 4-digit numeric code as the rhythm-gate fallback. Anything that's not exactly
# 4 digits is rejected at startup so we don't accidentally accept "" or "abc".
_PIN_RAW = (os.environ.get("SCHMALAL_PIN") or "").strip()
PIN = _PIN_RAW if (_PIN_RAW.isdigit() and len(_PIN_RAW) == 4) else ""
PIN_LENGTH = 4
SECRET_KEY = (os.environ.get("SCHMALAL_SECRET_KEY") or "").strip() or secrets.token_hex(32)
MAX_BYTES = int(os.environ.get("SCHMALAL_MAX_BYTES") or 100 * 1024 * 1024)        # 100 MB
MAX_DURATION = int(os.environ.get("SCHMALAL_MAX_DURATION_SEC") or 600)            # 10 min

RL_UPLOAD = os.environ.get("SCHMALAL_RL_UPLOAD", "20 per hour")
RL_SPLIT  = os.environ.get("SCHMALAL_RL_SPLIT", "10 per hour")
RL_CHECK  = os.environ.get("SCHMALAL_RL_CHECK", "240 per minute")
RL_DOWNLOAD = os.environ.get("SCHMALAL_RL_DOWNLOAD", "120 per hour")
RL_AUTH   = os.environ.get("SCHMALAL_RL_AUTH", "10 per minute")

# Hard cap on simultaneously-active pipelines per IP (claimed on /upload,
# released on /cancel, auto-released after TTL). In-memory only, so the
# effective cap is MAX × workers — fine for friends-scale.
MAX_CONCURRENT_PER_IP = int(os.environ.get("SCHMALAL_MAX_CONCURRENT_PER_IP") or 1)
PIPELINE_TTL_SEC      = int(os.environ.get("SCHMALAL_PIPELINE_TTL_SEC") or 1800)

# Rhythm gate: comma-separated semitone diffs. Default = Bayern 3 sound logo
# (D → C → G, intervals -2, +7). Empty disables the rhythm gate.
_RHYTHM_RAW = (os.environ.get("SCHMALAL_RHYTHM_INTERVALS") or "").strip()
RHYTHM_ENABLED = bool(_RHYTHM_RAW)
RHYTHM_INTERVALS: list[int] = []
if RHYTHM_ENABLED:
    try:
        RHYTHM_INTERVALS = [int(x.strip()) for x in _RHYTHM_RAW.split(",") if x.strip()]
        if not RHYTHM_INTERVALS:
            RHYTHM_ENABLED = False
    except ValueError:
        RHYTHM_ENABLED = False

UPSTREAM_TIMEOUT = (15, 290)
DOWNLOAD_TIMEOUT = (15, 290)

VALID_STEMS = {
    "voice", "music",
    "vocals", "drum", "bass", "piano",
    "electric_guitar", "acoustic_guitar",
    "synthesizer", "strings", "wind",
}
VALID_SPLITTERS = {"auto", "orion", "perseus", "phoenix", "andromeda", "lynx", "lyra"}
VALID_EXTRACTION = {"deep_extraction", "clear_cut"}

mimetypes.add_type("application/javascript", ".jsx")  # legacy/no-op for built dist

# ─── App setup ─────────────────────────────────────────────────────────────
DIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")

app = Flask(__name__, static_folder=DIST, static_url_path="/")
app.config["SECRET_KEY"] = SECRET_KEY
app.config["MAX_CONTENT_LENGTH"] = MAX_BYTES
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
# leave SESSION_COOKIE_SECURE off; the reverse proxy terminates TLS and the
# user can opt into it via the env var below if they want strict cookies
if os.environ.get("SCHMALAL_COOKIE_SECURE", "").lower() in ("1", "true", "yes"):
    app.config["SESSION_COOKIE_SECURE"] = True

limiter = Limiter(get_remote_address, app=app, storage_uri="memory://")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("schmalal")
if not LICENSE:
    log.warning("LALAL_LICENSE not set — every API call will return 500.")
if _PIN_RAW and not PIN:
    log.warning("SCHMALAL_PIN must be exactly 4 digits — disabled.")
if not PIN and not RHYTHM_ENABLED:
    log.warning("No auth gate configured — instance is open to anyone who finds the URL.")
if RHYTHM_ENABLED:
    log.info("rhythm gate active: %d notes, intervals=%s", len(RHYTHM_INTERVALS) + 1, RHYTHM_INTERVALS)
if PIN:
    log.info("pin gate active (4 digits)")


# ─── LALAL upstream tracking (feeds /health, no extra upstream calls) ──────
# /health must answer in <1 s and is polled every 30 s, so we never probe LALAL
# from it. Instead every real proxied call records its outcome here and
# /health reports "degraded" if the most recent call failed within the window.
UPSTREAM_ERROR_WINDOW_SEC = int(os.environ.get("SCHMALAL_UPSTREAM_ERROR_WINDOW_SEC") or 300)
_upstream_state = {"last_ok": 0.0, "last_error": 0.0, "last_error_msg": ""}
_upstream_lock = threading.Lock()


def _note_upstream(ok: bool, msg: str = ""):
    with _upstream_lock:
        if ok:
            _upstream_state["last_ok"] = time.time()
        else:
            _upstream_state["last_error"] = time.time()
            _upstream_state["last_error_msg"] = (msg or "")[:200]


def _upstream_check() -> str:
    """'ok' | 'degraded' for the LALAL dependency, based on recent real calls."""
    with _upstream_lock:
        last_ok = _upstream_state["last_ok"]
        last_err = _upstream_state["last_error"]
    if last_err and last_err > last_ok and time.time() - last_err < UPSTREAM_ERROR_WINDOW_SEC:
        return "degraded"
    return "ok"


def _lalal_post(url: str, **kwargs) -> requests.Response:
    """requests.post to LALAL that records connectivity/5xx outcomes for /health."""
    try:
        resp = requests.post(url, **kwargs)
    except requests.RequestException as e:
        _note_upstream(False, str(e))
        raise
    if resp.status_code >= 500:
        _note_upstream(False, f"HTTP {resp.status_code}")
    else:
        _note_upstream(True)
    return resp


# ─── Helpers ───────────────────────────────────────────────────────────────
def _require_license():
    if not LICENSE:
        abort(500, description="LALAL_LICENSE not configured on the server")
    return {"X-License-Key": LICENSE}


def _passthrough(resp: requests.Response) -> Response:
    return Response(
        resp.content,
        status=resp.status_code,
        content_type=resp.headers.get("Content-Type", "application/json"),
    )


def _content_disposition(filename: str) -> str:
    try:
        filename.encode("ascii")
        return f'attachment; filename="{filename}"'
    except UnicodeEncodeError:
        return f"attachment; filename*=utf-8''{quote(filename)}"


def _gate_required():
    return bool(PIN) or RHYTHM_ENABLED


def _is_authed():
    return (not _gate_required()) or session.get("authed") is True


# ─── Per-IP pipeline tracking ─────────────────────────────────────────────
_active_pipelines: dict[str, dict[str, float]] = defaultdict(dict)
_active_lock = threading.Lock()


def _cleanup_stale_pipelines():
    cutoff = time.time() - PIPELINE_TTL_SEC
    with _active_lock:
        for ip, sources in list(_active_pipelines.items()):
            for sid, ts in list(sources.items()):
                if ts < cutoff:
                    del sources[sid]
            if not sources:
                del _active_pipelines[ip]


def _claim_pipeline(ip: str, source_id: str):
    if not source_id:
        return
    with _active_lock:
        _active_pipelines[ip][source_id] = time.time()


def _release_pipeline(ip: str, source_id: str):
    if not source_id:
        return
    with _active_lock:
        if ip in _active_pipelines:
            _active_pipelines[ip].pop(source_id, None)
            if not _active_pipelines[ip]:
                del _active_pipelines[ip]


def _active_pipeline_count(ip: str) -> int:
    _cleanup_stale_pipelines()
    with _active_lock:
        return len(_active_pipelines.get(ip, {}))


def _check_rhythm(notes) -> bool:
    """Compare the user-played sequence to the configured intervals.

    The check is transposition-invariant: only the diffs between consecutive
    MIDI notes are compared. So a Bayern-3-style D-C-G (62, 60, 67) and
    D♯-C♯-G♯ (63, 61, 68) both match intervals [-2, 7].
    """
    if not RHYTHM_ENABLED:
        return False
    if not isinstance(notes, list) or len(notes) != len(RHYTHM_INTERVALS) + 1:
        return False
    try:
        ns = [int(n) for n in notes]
    except (TypeError, ValueError):
        return False
    diffs = [ns[i + 1] - ns[i] for i in range(len(ns) - 1)]
    return diffs == RHYTHM_INTERVALS


# ─── Auth gate (runs before every /api/* except /api/me + /api/auth) ──────
@app.before_request
def _guard_api():
    p = request.path or ""
    if not p.startswith("/api/"):
        return
    if p in ("/api/me", "/api/auth", "/api/healthz"):
        return
    if not _is_authed():
        return jsonify({"status": "error", "error": "auth required"}), 401


# ─── 429 → JSON ────────────────────────────────────────────────────────────
@app.errorhandler(429)
def _ratelimit_handler(e):
    return jsonify({
        "status": "error",
        "error": "Zu viele Versuche — bitte kurz warten.",
    }), 429


@app.errorhandler(413)
def _too_large(e):
    mb = MAX_BYTES // (1024 * 1024)
    return jsonify({"status": "error", "error": f"Datei zu groß (max {mb} MB)"}), 413


# ─── Frontend (Vite dist) ──────────────────────────────────────────────────
@app.route("/")
def index():
    idx = os.path.join(DIST, "index.html")
    if not os.path.exists(idx):
        return ("Frontend not built. Run `npm install && npm run build`.", 503)
    return send_from_directory(DIST, "index.html")


# ─── Health (Schmalsoft Hub convention, section 2) ─────────────────────────
def _health_payload():
    checks = {}
    status = "ok"

    # Without a license key every proxied call fails → not functional.
    checks["license"] = "ok" if LICENSE else "error"
    # Frontend bundle missing → "/" answers 503, users see nothing.
    checks["frontend"] = "ok" if os.path.exists(os.path.join(DIST, "index.html")) else "error"
    # No auth gate = open to anyone who finds the URL. Runs, but not as intended.
    checks["auth_gate"] = "ok" if _gate_required() else "degraded"
    # LALAL reachability, derived from recent real calls (no probe from here).
    checks["lalal"] = _upstream_check()

    if "error" in checks.values():
        status = "error"
    elif "degraded" in checks.values():
        status = "degraded"

    return {
        "status": status,
        "service": SERVICE_SLUG,
        "version": VERSION,
        "uptime": int(time.time() - STARTED_AT),
        "checks": checks,
        "time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


@app.route("/health")
@limiter.exempt
def health():
    payload = _health_payload()
    resp = jsonify(payload)
    resp.status_code = 503 if payload["status"] == "error" else 200
    resp.headers["Cache-Control"] = "no-store"
    return resp


# ─── Public API ────────────────────────────────────────────────────────────
@app.route("/api/healthz")
@limiter.exempt
def healthz():
    """Legacy alias for /health (kept for existing external checks)."""
    return health()


@app.route("/api/me")
def me():
    return jsonify({
        "authed": _is_authed(),
        "gates": {
            "pin": bool(PIN),
            "pin_length": PIN_LENGTH if PIN else 0,
            "rhythm": RHYTHM_ENABLED,
            "rhythm_length": (len(RHYTHM_INTERVALS) + 1) if RHYTHM_ENABLED else 0,
        },
        "license_configured": bool(LICENSE),
        "max_bytes": MAX_BYTES,
        "max_duration_sec": MAX_DURATION,
    })


@app.route("/api/auth", methods=["POST"])
@limiter.limit(RL_AUTH)
def auth():
    data = request.get_json(silent=True) or {}

    # No gate configured at all → anything goes (you'd see this only locally
    # when neither password nor rhythm is set in env).
    if not _gate_required():
        session["authed"] = True
        return jsonify({"authed": True})

    # Rhythm gate (notes: list of MIDI numbers)
    if "notes" in data:
        if not RHYTHM_ENABLED:
            return jsonify({"authed": False, "error": "Rhythm-Gate ist nicht aktiv"}), 400
        if _check_rhythm(data["notes"]):
            session["authed"] = True
            session.permanent = True
            log.info("auth: rhythm ok from %s", get_remote_address())
            return jsonify({"authed": True})
        log.info("auth: wrong rhythm from %s — got=%s", get_remote_address(), data.get("notes"))
        return jsonify({"authed": False, "error": "Falscher Rhythmus"}), 401

    # PIN gate (4-digit numeric)
    if "pin" in data:
        if not PIN:
            return jsonify({"authed": False, "error": "PIN-Gate ist nicht aktiv"}), 400
        candidate = data.get("pin")
        if not isinstance(candidate, str):
            candidate = "" if candidate is None else str(candidate)
        if len(candidate) == PIN_LENGTH and hmac.compare_digest(candidate, PIN):
            session["authed"] = True
            session.permanent = True
            log.info("auth: pin ok from %s", get_remote_address())
            return jsonify({"authed": True})
        log.info("auth: wrong pin from %s", get_remote_address())
        return jsonify({"authed": False, "error": "Falscher Code"}), 401

    return jsonify({"authed": False, "error": "Send {notes:[…]} or {pin:'…'}"}), 400


@app.route("/api/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"ok": True})


# ─── /api/upload ───────────────────────────────────────────────────────────
@app.route("/api/upload", methods=["POST"])
@limiter.limit(RL_UPLOAD)
def upload():
    ip = get_remote_address()
    active = _active_pipeline_count(ip)
    if active >= MAX_CONCURRENT_PER_IP:
        return jsonify({
            "status": "error",
            "error": f"Du hast schon {active} laufende{'n' if active == 1 else ''} Split — beende den erst.",
        }), 429

    if "file" not in request.files:
        return jsonify({"status": "error", "error": "no file provided (expected multipart field 'file')"}), 400
    f = request.files["file"]
    if not f.filename:
        return jsonify({"status": "error", "error": "empty filename"}), 400

    headers = _require_license()
    headers["Content-Disposition"] = _content_disposition(f.filename)

    try:
        upstream = _lalal_post(
            f"{LALAL_BASE}/upload/",
            headers=headers,
            data=f.stream,
            timeout=UPSTREAM_TIMEOUT,
        )
    except requests.RequestException as e:
        log.warning("upload upstream error: %s", e)
        return jsonify({"status": "error", "error": f"upload failed: {e}"}), 502

    if upstream.status_code != 200:
        return _friendly_lalal_error(upstream, "Upload")

    try:
        data = upstream.json()
    except ValueError:
        return _passthrough(upstream)

    duration = float(data.get("duration") or 0)
    if MAX_DURATION and duration > MAX_DURATION:
        sid = data.get("id")
        if sid:
            try:
                _lalal_post(
                    f"{LALAL_BASE}/delete/",
                    json={"source_id": sid},
                    headers=_require_license(),
                    timeout=10,
                )
            except requests.RequestException:
                pass
        return jsonify({
            "status": "error",
            "error": f"Audio zu lang: {int(duration)}s (max {MAX_DURATION}s).",
        }), 413

    _claim_pipeline(ip, data.get("id"))
    log.info("upload ok: id=%s duration=%.1fs size=%s ip=%s", data.get("id"), duration, data.get("size"), ip)
    return jsonify(data)


# ─── /api/split ────────────────────────────────────────────────────────────
def _build_split_request(job: dict):
    """Translate one frontend job into (lalal_url, json_body)."""
    if not isinstance(job, dict):
        raise ValueError("job must be an object")

    source_id = job.get("source_id")
    stem = job.get("stem")
    if not source_id or not stem:
        raise ValueError("job requires source_id and stem")
    if stem not in VALID_STEMS:
        raise ValueError(f"unsupported stem: {stem}")

    splitter = job.get("splitter") or "auto"
    if splitter not in VALID_SPLITTERS:
        raise ValueError(f"unsupported splitter: {splitter}")
    dereverb = bool(job.get("dereverb_enabled"))

    if stem == "voice":
        ncl = int(job.get("noise_cancelling_level", 1))
        if ncl not in (0, 1, 2):
            raise ValueError("noise_cancelling_level must be 0, 1, or 2")
        presets = {"stem": "voice", "noise_cancelling_level": ncl, "splitter": splitter}
        if dereverb:
            presets["dereverb_enabled"] = True
        return f"{LALAL_BASE}/split/voice_clean/", {"source_id": source_id, "presets": presets}

    if stem == "music":
        presets = {"stem": "music"}
        if dereverb:
            presets["dereverb_enabled"] = True
        return f"{LALAL_BASE}/split/demuser/", {"source_id": source_id, "presets": presets}

    extraction = job.get("extraction_level") or "deep_extraction"
    if extraction not in VALID_EXTRACTION:
        raise ValueError(f"unsupported extraction_level: {extraction}")
    presets = {"stem": stem, "extraction_level": extraction, "splitter": splitter}
    if dereverb:
        presets["dereverb_enabled"] = True
    multivocal = job.get("multivocal")
    if multivocal:
        if stem != "vocals" or multivocal != "lead_back":
            raise ValueError("multivocal=lead_back is only valid for stem=vocals")
        presets["multivocal"] = multivocal
    return f"{LALAL_BASE}/split/stem_separator/", {"source_id": source_id, "presets": presets}


@app.route("/api/split", methods=["POST"])
@limiter.limit(RL_SPLIT)
def split():
    payload = request.get_json(silent=True) or {}
    jobs = payload.get("jobs")
    if not isinstance(jobs, list) or not jobs:
        return jsonify({"status": "error", "error": "expected JSON {jobs:[...]} with at least one job"}), 400
    if len(jobs) > 8:
        return jsonify({"status": "error", "error": "too many jobs in one request"}), 400

    headers = _require_license()
    results = []
    for job in jobs:
        try:
            url, body = _build_split_request(job)
        except ValueError as e:
            results.append({"source_id": job.get("source_id"), "status": "error", "error": str(e)})
            continue
        try:
            resp = _lalal_post(url, json=body, headers=headers, timeout=UPSTREAM_TIMEOUT)
        except requests.RequestException as e:
            log.warning("split upstream error: %s", e)
            results.append({"source_id": job.get("source_id"), "status": "error", "error": f"upstream: {e}"})
            continue

        try:
            data = resp.json()
        except ValueError:
            data = {"raw": resp.text}

        if resp.status_code != 200:
            msg = (data.get("error") or data.get("detail") or resp.text or "").strip()
            results.append({
                "source_id": job.get("source_id"),
                "status": "error",
                "error": _friendly_message(resp.status_code, msg, "Split"),
                "http_status": resp.status_code,
            })
            continue

        results.append({
            "source_id": job.get("source_id"),
            "status": "success",
            "task_id": data.get("task_id"),
        })

    log.info("split: %s", [r.get("status") for r in results])
    return jsonify({"status": "success", "results": results})


# ─── /api/check ────────────────────────────────────────────────────────────
@app.route("/api/check", methods=["GET"])
@limiter.limit(RL_CHECK)
def check():
    raw = (request.args.get("id") or "").strip()
    if not raw:
        return jsonify({"status": "error", "error": "missing query param 'id'"}), 400
    task_ids = [t.strip() for t in raw.split(",") if t.strip()]
    if not task_ids:
        return jsonify({"status": "error", "error": "no task ids in query"}), 400
    if len(task_ids) > 8:
        return jsonify({"status": "error", "error": "too many task ids"}), 400

    headers = _require_license()
    try:
        resp = _lalal_post(
            f"{LALAL_BASE}/check/",
            json={"task_ids": task_ids},
            headers=headers,
            timeout=UPSTREAM_TIMEOUT,
        )
    except requests.RequestException as e:
        log.warning("check upstream error: %s", e)
        return jsonify({"status": "error", "error": f"upstream: {e}"}), 502

    if resp.status_code != 200:
        return _friendly_lalal_error(resp, "Check")

    try:
        data = resp.json()
    except ValueError:
        return jsonify({"status": "error", "error": "non-JSON upstream response"}), 502

    result = data.get("result") or {}
    statuses = {tid: (result.get(tid) or {}).get("status", "missing") for tid in task_ids}
    log.info("check: %s", statuses)
    return jsonify({
        "status": "success",
        "tasks": {tid: result.get(tid) for tid in task_ids},
    })


# ─── /api/cancel ───────────────────────────────────────────────────────────
@app.route("/api/cancel", methods=["POST"])
def cancel():
    payload = request.get_json(silent=True) or {}
    source_id = payload.get("source_id")
    if not source_id:
        return jsonify({"status": "error", "error": "Pass source_id to drop the upload via /delete/."}), 400

    _release_pipeline(get_remote_address(), source_id)

    headers = _require_license()
    try:
        resp = _lalal_post(
            f"{LALAL_BASE}/delete/",
            json={"source_id": source_id},
            headers=headers,
            timeout=UPSTREAM_TIMEOUT,
        )
    except requests.RequestException as e:
        return jsonify({"status": "error", "error": f"upstream: {e}"}), 502

    return _passthrough(resp)


# ─── /api/download ─────────────────────────────────────────────────────────
_FILENAME_SAFE = re.compile(r"[\x00-\x1f\\/:*?\"<>|]")


def _safe_filename(name: str) -> str:
    name = _FILENAME_SAFE.sub("_", name).strip()
    return name or "stem"


def _filename_from_upstream(header: str):
    if not header:
        return None
    msg = EmailMessage()
    msg["content-disposition"] = header
    return msg.get_filename()


@app.route("/api/download", methods=["GET"])
@limiter.limit(RL_DOWNLOAD)
def download():
    url = (request.args.get("url") or "").strip()
    requested_name = request.args.get("filename")
    if not url:
        return jsonify({"status": "error", "error": "missing query param 'url'"}), 400

    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme not in ("http", "https") or not (host == "lalal.ai" or host.endswith(".lalal.ai")):
        return jsonify({"status": "error", "error": "url host not allowed"}), 400

    fwd_headers = {}
    if "Range" in request.headers:
        fwd_headers["Range"] = request.headers["Range"]

    try:
        upstream = requests.get(url, stream=True, timeout=DOWNLOAD_TIMEOUT, headers=fwd_headers)
    except requests.RequestException as e:
        return jsonify({"status": "error", "error": f"upstream: {e}"}), 502

    if upstream.status_code not in (200, 206):
        body = upstream.text[:500]
        return jsonify({"status": "error", "error": "upstream download failed", "http_status": upstream.status_code, "body": body}), 502

    filename = (
        requested_name
        or _filename_from_upstream(upstream.headers.get("Content-Disposition", ""))
        or os.path.basename(parsed.path)
        or "stem"
    )
    filename = _safe_filename(filename)

    def gen():
        try:
            for chunk in upstream.iter_content(chunk_size=64 * 1024):
                if chunk:
                    yield chunk
        finally:
            upstream.close()

    response = Response(
        stream_with_context(gen()),
        status=upstream.status_code,
        content_type=upstream.headers.get("Content-Type", "application/octet-stream"),
    )
    response.headers["Content-Disposition"] = _content_disposition(filename)
    for h in ("Content-Length", "Content-Range", "Accept-Ranges"):
        if h in upstream.headers:
            response.headers[h] = upstream.headers[h]
    response.headers.setdefault("Accept-Ranges", "bytes")
    return response


# ─── Error humanisation ────────────────────────────────────────────────────
def _friendly_message(status: int, msg: str, ctx: str) -> str:
    """Map LALAL upstream errors to something a user can act on."""
    low = (msg or "").lower()
    if status == 401:
        return f"{ctx}: License-Key abgelehnt (admin: prüfe LALAL_LICENSE)."
    if status == 402 or "insufficient" in low or "quota" in low or "minutes" in low:
        return f"{ctx}: LALAL-Credits aufgebraucht. Probier's später."
    if status == 429 or "too many" in low:
        return f"{ctx}: LALAL drosselt — kurz warten."
    if status >= 500:
        return f"{ctx}: LALAL antwortet gerade nicht ({status})."
    return f"{ctx}: {msg or f'HTTP {status}'}"


def _friendly_lalal_error(resp: requests.Response, ctx: str):
    try:
        data = resp.json()
    except ValueError:
        data = {}
    msg = (data.get("error") or data.get("detail") or resp.text or "").strip()
    out = {"status": "error", "error": _friendly_message(resp.status_code, msg, ctx)}
    return jsonify(out), resp.status_code if 400 <= resp.status_code < 600 else 502


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
