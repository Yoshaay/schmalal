// Network calls to the Flask proxy in front of LALAL.AI.

class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function readJson(r) {
  try { return await r.json(); } catch (_) { return null; }
}

function errorFrom(status, body) {
  const msg = (body && (body.error || body.detail)) || null;
  if (status === 401) return new ApiError(msg || 'Anmeldung erforderlich', 401, body);
  if (status === 413) return new ApiError(msg || 'Datei zu groß', 413, body);
  if (status === 429) return new ApiError(msg || 'Zu viele Anfragen — kurz warten.', 429, body);
  return new ApiError(msg || `HTTP ${status}`, status, body);
}

export async function getMe() {
  const r = await fetch('/api/me', { credentials: 'same-origin' });
  const data = await readJson(r);
  if (!r.ok) throw errorFrom(r.status, data);
  return data;
}

// Body is `{password: "…"}` for the password gate or `{notes: [60, 62, …]}`
// for the rhythm gate. Backend dispatches on the key.
export async function logout() {
  try {
    await fetch('/api/logout', {
      method: 'POST',
      credentials: 'same-origin',
    });
  } catch (_) {
    // best-effort; either way we want the UI to drop back to the gate
  }
}

export async function authenticate(body) {
  const r = await fetch('/api/auth', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await readJson(r);
  if (!r.ok) throw errorFrom(r.status, data);
  return data;
}

export function uploadFile(file, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.withCredentials = true;
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) onProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onerror = () => reject(new ApiError('Netzwerkfehler beim Upload', 0));
    xhr.onabort = () => reject(new ApiError('Upload abgebrochen', 0));
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch (_) {}
      if (xhr.status >= 200 && xhr.status < 300 && data && data.id) {
        resolve(data);
      } else {
        reject(errorFrom(xhr.status, data));
      }
    };
    if (signal) signal.addEventListener('abort', () => xhr.abort());
    const fd = new FormData();
    fd.append('file', file, file.name);
    xhr.send(fd);
  });
}

export async function startSplits(jobs, signal) {
  const r = await fetch('/api/split', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobs }),
    signal,
  });
  const data = await readJson(r);
  if (!r.ok || !data || data.status !== 'success') {
    throw errorFrom(r.status, data);
  }
  const results = data.results || [];
  return results.map((res) => {
    if (res.status !== 'success') throw new ApiError(res.error || 'Split-Job fehlgeschlagen', r.status, res);
    if (!res.task_id) throw new ApiError('Kein task_id zurückbekommen', r.status, res);
    return res.task_id;
  });
}

export async function checkTasks(taskIds, signal) {
  const r = await fetch('/api/check?id=' + encodeURIComponent(taskIds.join(',')), {
    credentials: 'same-origin',
    signal,
  });
  const data = await readJson(r);
  if (!r.ok || !data || data.status !== 'success') throw errorFrom(r.status, data);
  return data.tasks || {};
}

export async function cancelSource(sourceId) {
  try {
    await fetch('/api/cancel', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_id: sourceId }),
    });
  } catch (_) {
    // best-effort cleanup
  }
}

// pick the right track from a LALAL task result for a given stem row
export function pickTrack(tracks, row) {
  if (!tracks || !tracks.length) return null;
  const lc = (s) => (s || '').toString().toLowerCase();
  const stem = row.api;

  const isStemMatch = (t) => {
    const l = lc(t.label);
    if (l.includes('no ') || l.includes('back') || l.includes('instrumental')) return false;
    if (stem === 'drum'        && l.includes('drum'))  return true;
    if (stem === 'vocals'      && l.includes('vocal')) return true;
    if (stem === 'bass'        && l.includes('bass'))  return true;
    if (stem === 'piano'       && l.includes('piano')) return true;
    if (stem === 'synthesizer' && (l.includes('synth') || l.includes('sound'))) return true;
    return false;
  };
  const isBackMatch = (t) => {
    const l = lc(t.label);
    return l.includes('no ') || l.includes('back') || l.includes('instrumental');
  };

  if (row.source === 'stem') {
    return tracks.find(isStemMatch) || tracks.find(t => !isBackMatch(t)) || tracks[0];
  }
  return tracks.find(isBackMatch) || tracks.find(t => !isStemMatch(t)) || tracks[1] || tracks[0];
}

export { ApiError };
