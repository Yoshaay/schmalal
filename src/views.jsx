// View components for each app state.

import {
  ACCENT, INK, INK_MUTED, SURFACE, LINE, RED,
  STEMS_BY_COUNT,
  fmtBytes, fmtTime, fmtSecs, downloadName,
} from './tokens.js';
import { Button, IconButton, Waveform } from './components.jsx';
import { useStemPlayer } from './audio.js';

export function Idle({ onPickFiles, onDrop, dragOver, onDragEnter, onDragLeave, onDragOver }) {
  return (
    <div
      onClick={onPickFiles}
      onDrop={onDrop}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      style={{
        width: '100%', height: 320, position: 'relative',
        borderRadius: 24,
        background: dragOver ? '#D946EF15' : SURFACE,
        border: `1.5px ${dragOver ? 'solid' : 'dashed'} ${dragOver ? ACCENT.vocals : INK + '20'}`,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 18, overflow: 'hidden', cursor: 'pointer',
        transition: 'background .15s, border-color .15s',
      }}>
      <div style={{
        width: 56, height: 56, borderRadius: 16, background: INK,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      </div>

      <div style={{ textAlign: 'center' }}>
        <div style={{
          fontFamily: '"Space Grotesk", system-ui, sans-serif',
          fontSize: 32, fontWeight: 600, letterSpacing: -1, color: INK,
        }}>
          Track hier reinziehen.
        </div>
        <div style={{ fontSize: 15, color: INK_MUTED, marginTop: 6 }}>
          MP3, WAV, FLAC, MP4 · oder{' '}
          <span style={{ color: INK, textDecoration: 'underline', textUnderlineOffset: 3 }}>Datei wählen</span>
        </div>
      </div>
    </div>
  );
}

export function UploadingView({ fileName, fileSize, progress, onCancel }) {
  return (
    <div style={{
      width: '100%', minHeight: 320, padding: 36,
      borderRadius: 24, background: SURFACE, border: '1px solid ' + LINE,
      display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 24,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12, background: INK,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: '"Space Grotesk", system-ui, sans-serif',
            fontSize: 22, fontWeight: 600, letterSpacing: -0.5, color: INK,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{fileName}</div>
          <div style={{ fontSize: 14, color: INK_MUTED, marginTop: 2 }}>
            Lädt hoch · {fmtBytes(fileSize)}
          </div>
        </div>
        <div style={{
          fontFamily: '"Space Grotesk", system-ui, sans-serif',
          fontSize: 36, fontWeight: 600, letterSpacing: -1.5, color: INK,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {progress}<span style={{ fontSize: 22, color: INK_MUTED }}>%</span>
        </div>
      </div>
      <div style={{ height: 8, background: '#0000000a', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${progress}%`, height: '100%', background: ACCENT.drums, transition: 'width .2s' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={{
          background: 'none', border: 'none', color: INK_MUTED, fontSize: 13,
          textDecoration: 'underline', textUnderlineOffset: 3, cursor: 'pointer', padding: 0,
        }}>abbrechen</button>
      </div>
    </div>
  );
}

export function ProcessingView({ fileName, stemsCount, jobs, onCancel }) {
  const stems = STEMS_BY_COUNT[stemsCount];

  const progressByRowId = {};
  for (const row of stems) {
    const job = jobs.find((j) => j.api === row.api);
    progressByRowId[row.id] = job ? job.progress : 0;
  }
  const avg = jobs.length
    ? jobs.reduce((a, j) => a + j.progress, 0) / jobs.length / 100
    : 0;
  const remainingSec = avg > 0.02 && avg < 1 ? Math.round((1 - avg) * 60) : null;

  return (
    <div style={{
      width: '100%', minHeight: 320, padding: 36,
      borderRadius: 24, background: SURFACE, border: '1px solid ' + LINE,
      display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 20,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12, background: INK,
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
        }}>
          <div style={{ display: 'flex', gap: 2, alignItems: 'center', height: 18 }}>
            {[
              { h: 8,  c: ACCENT.vocals },
              { h: 14, c: '#fff' },
              { h: 6,  c: ACCENT.vocals },
              { h: 11, c: '#fff' },
            ].map((b, i) => (
              <div key={i} style={{
                width: 2.5, height: b.h, background: b.c, borderRadius: 1,
                animation: `hfPulse 0.9s ease-in-out ${i * 0.1}s infinite alternate`,
              }} />
            ))}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: '"Space Grotesk", system-ui, sans-serif',
            fontSize: 22, fontWeight: 600, letterSpacing: -0.5, color: INK,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{fileName}</div>
          <div style={{ fontSize: 14, color: INK_MUTED, marginTop: 2 }}>
            Splittet in {stemsCount} Stems
            {remainingSec != null && ` · ~ ${remainingSec}s übrig`}
          </div>
        </div>
        <div style={{
          fontFamily: '"Space Grotesk", system-ui, sans-serif',
          fontSize: 36, fontWeight: 600, letterSpacing: -1.5, color: INK,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {Math.round(avg * 100)}<span style={{ fontSize: 22, color: INK_MUTED }}>%</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        {stems.map((s) => {
          const pct = (progressByRowId[s.id] || 0) / 100;
          return (
            <div key={s.id} style={{
              flex: 1, height: 8, background: '#0000000a', borderRadius: 4, overflow: 'hidden',
            }}>
              <div style={{ width: `${pct * 100}%`, height: '100%', background: s.color, transition: 'width .3s' }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: INK_MUTED }}>
        {stems.map((s) => (
          <div key={s.id} style={{ flex: 1, textAlign: 'left', textTransform: 'lowercase' }}>{s.label}</div>
        ))}
      </div>

      <div style={{
        marginTop: 4, display: 'flex', justifyContent: 'flex-end',
        fontSize: 13, color: INK_MUTED,
      }}>
        <button onClick={onCancel} style={{
          background: 'none', border: 'none', color: INK_MUTED, fontSize: 13,
          textDecoration: 'underline', textUnderlineOffset: 3, cursor: 'pointer', padding: 0,
        }}>abbrechen</button>
      </div>
    </div>
  );
}

export function ResultView({ fileName, fileSize, stems, splitMs, onNew }) {
  const player = useStemPlayer(stems);

  const downloadAll = () => {
    stems.forEach((s, i) => {
      if (!s.downloadUrl) return;
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = s.downloadUrl;
        a.download = downloadName(fileName, s.label);
        document.body.appendChild(a); a.click(); a.remove();
      }, i * 250);
    });
  };

  const meta = [
    fmtTime(player.duration),
    `in ${fmtSecs(splitMs)} gesplittet`,
    `${stems.length} Stems`,
  ].join(' · ');

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px',
        background: SURFACE, borderRadius: 16, border: '1px solid ' + LINE, marginBottom: 12,
      }}>
        <button onClick={player.toggle} disabled={!player.ready} style={{
          width: 40, height: 40, borderRadius: 10, background: INK, border: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: player.ready ? 'pointer' : 'default', opacity: player.ready ? 1 : 0.5,
        }}>
          {player.isPlaying ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="#fff">
              <rect x="2.5" y="2" width="3" height="10" rx="0.6" />
              <rect x="8.5" y="2" width="3" height="10" rx="0.6" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="#fff"><path d="M3.5 2l8 5-8 5z" /></svg>
          )}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: '"Space Grotesk", system-ui, sans-serif',
            fontSize: 17, fontWeight: 600, color: INK, letterSpacing: -0.3,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{fileName}</div>
          <div style={{ fontSize: 13, color: INK_MUTED }}>{meta}</div>
        </div>
        <Button small onClick={onNew}>↺ Neuer Track</Button>
        <Button small primary onClick={downloadAll}>↓ Alle laden</Button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {stems.map((s, i) => {
          const isMuted = !!player.muted[s.id] || (player.solo && player.solo !== s.id);
          const isSolo = player.solo === s.id;
          const isErrored = !!s.error;
          return (
            <div key={s.id} style={{
              display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px',
              background: SURFACE, borderRadius: 14, border: '1px solid ' + LINE,
              opacity: isErrored ? 0.55 : 1,
            }}>
              <button onClick={player.toggle} disabled={!player.ready || isErrored} style={{
                width: 38, height: 38, borderRadius: '50%',
                background: player.isPlaying ? s.color : '#fff',
                border: `1.5px solid ${s.color}`,
                color: player.isPlaying ? '#fff' : s.color,
                cursor: (!player.ready || isErrored) ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                opacity: (!player.ready || isErrored) ? 0.5 : 1,
              }}>
                <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor">
                  {player.isPlaying
                    ? <><rect x="2" y="2" width="2.5" height="7" rx="0.5"/><rect x="6.5" y="2" width="2.5" height="7" rx="0.5"/></>
                    : <path d="M3 2l6 3.5L3 9z" />}
                </svg>
              </button>

              <div style={{ width: 100, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: s.color }} />
                <span style={{
                  fontFamily: '"Space Grotesk", system-ui, sans-serif',
                  fontSize: 16, fontWeight: 550, color: INK, letterSpacing: -0.2,
                }}>{s.label}</span>
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <Waveform
                  width={440} height={36}
                  color={s.color} seed={i + 5}
                  progress={s.downloadUrl ? player.progress : null}
                  dim={isMuted}
                  onSeek={s.downloadUrl ? player.seek : undefined}
                />
              </div>

              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <IconButton size={28} color={s.color} title="Stumm"
                            active={!!player.muted[s.id]}
                            onClick={() => player.toggleMute(s.id)}
                            disabled={!player.ready || isErrored}>M</IconButton>
                <IconButton size={28} color={s.color} title="Solo"
                            active={isSolo}
                            onClick={() => player.toggleSolo(s.id)}
                            disabled={!player.ready || isErrored}>S</IconButton>
                <IconButton size={28} title={isErrored ? s.error : 'Laden'}
                            disabled={isErrored || !s.downloadUrl}
                            onClick={() => {
                              if (!s.downloadUrl) return;
                              const a = document.createElement('a');
                              a.href = s.downloadUrl;
                              a.download = downloadName(fileName, s.label);
                              document.body.appendChild(a); a.click(); a.remove();
                            }}>
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5.5 1.5v6M3 5.5l2.5 2.5L8 5.5M2 9.5h7" />
                  </svg>
                </IconButton>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ErrorView({ fileName, message, onReset }) {
  return (
    <div style={{
      width: '100%', minHeight: 320, padding: 40,
      borderRadius: 24, background: SURFACE, border: `1.5px solid ${RED}40`,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 12, textAlign: 'center',
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: 16, background: RED,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 5v7M11 16h.01M3 19h16L11 4z" />
        </svg>
      </div>
      <div style={{
        fontFamily: '"Space Grotesk", system-ui, sans-serif',
        fontSize: 26, fontWeight: 600, letterSpacing: -0.6,
      }}>
        Konnte nicht splitten
      </div>
      {fileName && <div style={{ fontSize: 13, color: INK_MUTED }}>{fileName}</div>}
      <div style={{
        fontSize: 14, color: INK, maxWidth: 520,
        background: '#0000000a', padding: '10px 14px', borderRadius: 10,
      }}>
        {message}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <Button primary onClick={onReset}>↺ Neuer Track</Button>
      </div>
    </div>
  );
}
