// App shell — state machine for one track at a time:
// idle → uploading → processing → result | error

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ACCENT, INK, INK_MUTED, BG, SURFACE, LINE, STEMS_BY_COUNT, isMediaFile, downloadName } from './tokens.js';
import { Logo, StemPresetCards } from './components.jsx';
import { Idle, UploadingView, ProcessingView, ResultView, ErrorView } from './views.jsx';
import { uploadFile, startSplits, checkTasks, cancelSource, pickTrack, ApiError } from './api.js';

export default function App({ onAuthExpired, onLogout, gated }) {
  const [stemsCount, setStemsCount] = useState(2);
  const [view, setView] = useState({ kind: 'idle' });
  const [dragOver, setDragOver] = useState(false);
  const [scale, setScale] = useState(1);
  const inputRef = useRef(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const abortRef = useRef(null);

  useEffect(() => {
    const fit = () => {
      const sx = window.innerWidth  / 1280;
      const sy = window.innerHeight / 800;
      setScale(Math.min(sx, sy, 1));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const handleApiError = useCallback((e, prefix) => {
    if (e instanceof ApiError && e.status === 401) {
      if (onAuthExpired) onAuthExpired();
      return true;
    }
    return false;
  }, [onAuthExpired]);

  const reset = useCallback(() => {
    const sid = viewRef.current && viewRef.current.sourceId;
    if (sid) cancelSource(sid);
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
    setView({ kind: 'idle' });
  }, []);

  // tab title shows live progress / status so a backgrounded tab still
  // tells the user where they are.
  useEffect(() => {
    const base = 'schmalal — tracks splitten.';
    let next;
    if (view.kind === 'uploading') {
      next = `schmalal — uploading ${view.uploadProgress || 0}%`;
    } else if (view.kind === 'processing') {
      const jobs = view.jobs || [];
      const avg = jobs.length
        ? Math.round(jobs.reduce((a, j) => a + (j.progress || 0), 0) / jobs.length)
        : 0;
      next = `schmalal — splitting ${avg}%`;
    } else if (view.kind === 'result') {
      next = 'schmalal — fertig';
    } else {
      next = base;
    }
    document.title = next;
  }, [view]);

  // best-effort cleanup on tab close: tell LALAL to drop the source
  useEffect(() => {
    const onUnload = () => {
      const sid = viewRef.current && viewRef.current.sourceId;
      if (!sid || !navigator.sendBeacon) return;
      const blob = new Blob([JSON.stringify({ source_id: sid })], { type: 'application/json' });
      navigator.sendBeacon('/api/cancel', blob);
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  const cancelInFlight = useCallback(() => {
    const cur = viewRef.current;
    const sourceId = cur && cur.sourceId;
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
    if (sourceId) cancelSource(sourceId);
    setView({ kind: 'idle' });
  }, []);

  const runPipeline = useCallback(async (file) => {
    if (abortRef.current) abortRef.current.abort();
    const prevSource = viewRef.current && viewRef.current.sourceId;
    if (prevSource) cancelSource(prevSource);
    const ac = new AbortController();
    abortRef.current = ac;

    const startTime = Date.now();
    const stemsForRun = STEMS_BY_COUNT[stemsCount];
    const apiStems = [...new Set(stemsForRun.map((s) => s.api))];

    setView({ kind: 'uploading', file, fileName: file.name, fileSize: file.size, uploadProgress: 0 });
    let sourceId;
    try {
      const up = await uploadFile(file, (pct) => {
        if (viewRef.current.kind === 'uploading') {
          setView((v) => ({ ...v, uploadProgress: pct }));
        }
      }, ac.signal);
      if (ac.signal.aborted) return;
      sourceId = up.id;
    } catch (e) {
      if (ac.signal.aborted) return;
      if (handleApiError(e)) return;
      setView({ kind: 'error', fileName: file.name, message: 'Upload: ' + e.message });
      return;
    }

    // Run splits sequentially — LALAL serialises tasks per license anyway, and
    // a single in-flight task gives crisp per-stem progress instead of N stuck
    // at 0% behind a queue.
    const jobs = apiStems.map((api) => ({ api, taskId: null, progress: 0, result: null }));
    setView({
      kind: 'processing', file, fileName: file.name, fileSize: file.size,
      sourceId, jobs: [...jobs], startTime,
    });

    // visibility-aware sleep: when the tab is hidden the browser throttles
    // setTimeout to once a minute, which makes polling look stuck. Wake up
    // immediately when the user comes back so the next poll is fresh.
    const sleep = (ms) => new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        document.removeEventListener('visibilitychange', onVis);
        resolve();
      };
      const onVis = () => { if (document.visibilityState === 'visible') finish(); };
      const t = setTimeout(finish, ms);
      document.addEventListener('visibilitychange', onVis);
    });
    const updateJobs = () => setView((v) => v.kind === 'processing' ? { ...v, jobs: [...jobs] } : v);

    try {
      for (let i = 0; i < apiStems.length; i++) {
        if (ac.signal.aborted) return;
        const api = apiStems[i];

        // Start one split task
        let taskId;
        try {
          [taskId] = await startSplits([{
            source_id: sourceId, stem: api, splitter: 'auto',
            extraction_level: 'deep_extraction', dereverb_enabled: false,
          }], ac.signal);
        } catch (e) {
          if (ac.signal.aborted) return;
          if (handleApiError(e)) return;
          setView({ kind: 'error', fileName: file.name, sourceId, message: 'Split: ' + e.message });
          return;
        }
        jobs[i].taskId = taskId;
        updateJobs();

        // Poll just this task until success
        let stuck = 0;
        while (true) {
          if (ac.signal.aborted) return;
          let tasks;
          try {
            tasks = await checkTasks([taskId], ac.signal);
          } catch (e) {
            if (ac.signal.aborted) return;
            if (handleApiError(e)) return;
            stuck += 1;
            if (stuck > 6) {
              setView({ kind: 'error', fileName: file.name, sourceId, message: 'Polling: ' + e.message });
              return;
            }
            await sleep(5000);
            continue;
          }
          stuck = 0;
          const t = tasks[taskId];
          if (!t) { await sleep(2500); continue; }
          if (t.status === 'progress') {
            jobs[i].progress = Number(t.progress) || 0;
            updateJobs();
            await sleep(2500);
            continue;
          }
          if (t.status === 'success') {
            jobs[i].progress = 100;
            jobs[i].result = t.result;
            updateJobs();
            break;
          }
          if (t.status === 'cancelled') {
            setView({ kind: 'error', fileName: file.name, sourceId, message: 'Server-seitig abgebrochen' });
            return;
          }
          setView({ kind: 'error', fileName: file.name, sourceId, message: `Status: ${t.status}` });
          return;
        }
      }

      // All tasks finished — assemble the result
      const stems = stemsForRun.map((row) => {
        const j = jobs.find((x) => x.api === row.api);
        if (!j || !j.result) return { ...row, error: 'Kein Ergebnis' };
        const track = pickTrack(j.result.tracks, row);
        if (!track || !track.url) return { ...row, error: 'Kein Track' };
        const dn = downloadName(file.name, row.label);
        return {
          ...row, track,
          downloadUrl: '/api/download?url=' + encodeURIComponent(track.url) + '&filename=' + encodeURIComponent(dn),
        };
      });
      setView({
        kind: 'result', fileName: file.name, fileSize: file.size,
        sourceId, stems, splitMs: Date.now() - startTime,
      });
    } catch (e) {
      if (ac.signal.aborted) return;
      if (handleApiError(e)) return;
      setView({ kind: 'error', fileName: file.name, sourceId, message: 'Split: ' + e.message });
    }
  }, [stemsCount, handleApiError]);

  const acceptFiles = useCallback((list) => {
    const arr = Array.from(list || []).filter(isMediaFile);
    if (!arr.length) return;
    runPipeline(arr[0]);
  }, [runPipeline]);

  const onDragEnter = (e) => { e.preventDefault(); setDragOver(true); };
  const onDragOver  = (e) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = (e) => { e.preventDefault(); if (e.target === e.currentTarget) setDragOver(false); };
  const onDrop      = (e) => { e.preventDefault(); setDragOver(false); acceptFiles(e.dataTransfer.files); };

  const stemsLocked = view.kind !== 'idle' && view.kind !== 'error';

  return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#e8e4dc',
    }}>
      <div style={{
        width: 1280, height: 800,
        transform: `scale(${scale})`, transformOrigin: 'center',
        boxShadow: '0 30px 80px rgba(0,0,0,0.12)', borderRadius: 16, overflow: 'hidden',
        background: BG,
      }}>
        <div
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          style={{
            width: '100%', height: '100%', position: 'relative',
            padding: '32px 40px', boxSizing: 'border-box',
            display: 'flex', flexDirection: 'column',
          }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Logo size={22} />
            {gated && (
              <button
                onClick={onLogout}
                title="abmelden"
                aria-label="abmelden"
                style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: SURFACE, border: '1px solid ' + LINE,
                  color: INK_MUTED, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background .15s, color .15s, border-color .15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = INK;
                  e.currentTarget.style.color = '#fff';
                  e.currentTarget.style.borderColor = INK;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = SURFACE;
                  e.currentTarget.style.color = INK_MUTED;
                  e.currentTarget.style.borderColor = LINE;
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2"
                     strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
                  <line x1="12" y1="2" x2="12" y2="12" />
                </svg>
              </button>
            )}
          </div>

          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            justifyContent: 'center', gap: 28,
            maxWidth: 880, margin: '0 auto', width: '100%',
          }}>
            {view.kind === 'idle' && (
              <>
                <h1 style={{
                  margin: 0, textAlign: 'center',
                  fontFamily: '"Space Grotesk", system-ui, sans-serif',
                  fontSize: 48, fontWeight: 600, letterSpacing: -2, lineHeight: 1.05, color: INK,
                }}>
                  Track rein, <span style={{ color: ACCENT.vocals, fontStyle: 'italic' }}>Stems</span> raus.
                </h1>
                <Idle
                  onPickFiles={() => inputRef.current?.click()}
                  dragOver={dragOver}
                  onDragEnter={onDragEnter} onDragOver={onDragOver}
                  onDragLeave={onDragLeave} onDrop={onDrop}
                />
                <StemPresetCards
                  value={stemsCount}
                  onChange={setStemsCount}
                  disabled={stemsLocked}
                />
              </>
            )}
            {view.kind === 'uploading' && (
              <UploadingView
                fileName={view.fileName} fileSize={view.fileSize}
                progress={view.uploadProgress} onCancel={cancelInFlight}
              />
            )}
            {view.kind === 'processing' && (
              <ProcessingView
                fileName={view.fileName} stemsCount={stemsCount}
                jobs={view.jobs} onCancel={cancelInFlight}
              />
            )}
            {view.kind === 'result' && (
              <ResultView
                fileName={view.fileName} fileSize={view.fileSize}
                stems={view.stems} splitMs={view.splitMs} onNew={reset}
              />
            )}
            {view.kind === 'error' && (
              <ErrorView
                fileName={view.fileName} message={view.message} onReset={reset}
              />
            )}
          </div>

          <input
            ref={inputRef} type="file" accept="audio/*,video/*" multiple={false}
            style={{ display: 'none' }}
            onChange={(e) => { acceptFiles(e.target.files); e.target.value = ''; }}
          />

          <div style={{
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            gap: 8, fontSize: 12, color: INK_MUTED, marginTop: 18,
          }}>
            <span style={{ width: 6, height: 6, background: INK, transform: 'rotate(45deg)', display: 'inline-block' }} />
            powered by <span style={{ color: INK, fontWeight: 550 }}>schmalsoft solutions</span>
          </div>

          {dragOver && view.kind !== 'idle' && (
            <div style={{
              position: 'absolute', inset: 0, background: '#D946EF22',
              border: `3px dashed ${ACCENT.vocals}`, borderRadius: 16, pointerEvents: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: '"Space Grotesk", system-ui, sans-serif',
              fontSize: 28, fontWeight: 600, color: INK, letterSpacing: -0.5,
            }}>
              loslassen zum Ersetzen
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
