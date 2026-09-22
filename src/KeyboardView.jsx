// Rhythm-gate login. User taps a sequence of notes on a one-octave piano
// (C4 to C5). The backend checks the *intervals*, not the absolute pitch —
// so the same melodic shape transposed (e.g. D#-C#-G# instead of D-C-G) works.

import { useState, useEffect, useRef, useCallback } from 'react';
import { ACCENT, INK, INK_MUTED, BG, SURFACE, LINE, RED } from './tokens.js';
import { Logo, Spinner } from './components.jsx';
import { authenticate, ApiError } from './api.js';
import { playNote, playSuccess, playFail } from './synth.js';

// White keys C..C (8 keys), black keys positioned absolutely.
const WHITE_KEYS = [
  { midi: 60, label: 'C',  x: 0   },
  { midi: 62, label: 'D',  x: 60  },
  { midi: 64, label: 'E',  x: 120 },
  { midi: 65, label: 'F',  x: 180 },
  { midi: 67, label: 'G',  x: 240 },
  { midi: 69, label: 'A',  x: 300 },
  { midi: 71, label: 'B',  x: 360 },
  { midi: 72, label: 'C',  x: 420 },
];
const BLACK_KEYS = [
  { midi: 61, label: 'C♯', x: 42  },
  { midi: 63, label: 'D♯', x: 102 },
  { midi: 66, label: 'F♯', x: 222 },
  { midi: 68, label: 'G♯', x: 282 },
  { midi: 70, label: 'A♯', x: 342 },
];

// Computer-keyboard row → MIDI (a typical "ASDF piano" layout).
const KB_TO_MIDI = {
  a: 60, w: 61, s: 62, e: 63, d: 64, f: 65,
  t: 66, g: 67, y: 68, h: 69, u: 70, j: 71, k: 72,
};

const SLOT_COLORS = [ACCENT.vocals, ACCENT.drums, ACCENT.bass, ACCENT.piano, ACCENT.synth];

export default function KeyboardView({ length = 3, hasPinFallback, onAuthed, onUsePin }) {
  const [notes, setNotes] = useState([]);
  const [pressed, setPressed] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [shake, setShake] = useState(false);
  const [scale, setScale] = useState(1);

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

  // auto-dismiss the error pill after 3 s
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 3000);
    return () => clearTimeout(t);
  }, [error]);

  const submitNotes = useCallback(async (n) => {
    setSubmitting(true);
    try {
      await authenticate({ notes: n });
      playSuccess();
      // brief delay so the success chime finishes before the view swaps
      setTimeout(() => onAuthed(), 320);
    } catch (e) {
      const msg = e instanceof ApiError && e.status === 429
        ? (e.message || 'Zu viele Versuche — kurz warten.')
        : 'hmm — falscher Code.';
      setError(msg);
      playFail();
      setShake(true);
      setTimeout(() => {
        setShake(false);
        setNotes([]);
        setSubmitting(false);
      }, 600);
    }
  }, [onAuthed]);

  const handlePress = useCallback((midi) => {
    if (submitting) return;
    playNote(midi);
    setPressed(midi);
    setTimeout(() => setPressed((p) => (p === midi ? null : p)), 220);
    setError(null);
    setNotes((prev) => {
      if (prev.length >= length) return prev;
      const next = [...prev, midi];
      if (next.length === length) {
        // small delay so the last note "rings" before the auth posts
        setTimeout(() => submitNotes(next), 250);
      }
      return next;
    });
  }, [submitting, length, submitNotes]);

  // Computer-keyboard mapping (A..K row plus accidentals). Lets power users
  // type the rhythm rather than mouse-tap.
  const handlerRef = useRef(handlePress);
  handlerRef.current = handlePress;
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.repeat) return;
      const target = (e.target && e.target.tagName) || '';
      if (target === 'INPUT' || target === 'TEXTAREA') return;
      const midi = KB_TO_MIDI[e.key.toLowerCase()];
      if (midi != null) {
        e.preventDefault();
        handlerRef.current(midi);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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
        <div style={{
          width: '100%', height: '100%',
          padding: '32px 40px', boxSizing: 'border-box',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Logo size={22} />
          </div>

          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 28,
          }}>
            <div style={{ textAlign: 'center' }}>
              <h1 style={{
                margin: '0 0 4px',
                fontFamily: '"Space Grotesk", system-ui, sans-serif',
                fontSize: 42, fontWeight: 600, letterSpacing: -1.6, lineHeight: 1.05, color: INK,
              }}>
                Tipp das <span style={{ color: ACCENT.vocals, fontStyle: 'italic' }}>Sound-Logo</span>.
              </h1>
              <div style={{ fontSize: 14, color: INK_MUTED, marginTop: 6 }}>
                {length} Noten — Intervalle zählen, du kannst's transponieren.
              </div>
            </div>

            {/* slot dots */}
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              {Array.from({ length }).map((_, i) => {
                const filled = i < notes.length;
                const c = SLOT_COLORS[i % SLOT_COLORS.length];
                return (
                  <span key={i} style={{
                    width: 14, height: 14, borderRadius: '50%',
                    background: filled ? c : 'transparent',
                    border: `1.5px solid ${filled ? c : INK + '30'}`,
                    transition: 'background .15s, border-color .15s, transform .15s',
                    transform: filled ? 'scale(1.05)' : 'scale(1)',
                  }} />
                );
              })}
            </div>

            {/* keyboard */}
            <div style={{
              animation: shake ? 'hfShake 0.5s' : 'none',
            }}>
              <div style={{
                position: 'relative',
                width: 480, height: 200,
                userSelect: 'none', touchAction: 'manipulation',
              }}>
                {/* white keys */}
                {WHITE_KEYS.map((k) => {
                  const isPressed = pressed === k.midi;
                  return (
                    <button
                      key={k.midi}
                      onPointerDown={(e) => { e.preventDefault(); handlePress(k.midi); }}
                      aria-label={`${k.label} (${k.midi})`}
                      style={{
                        position: 'absolute', left: k.x, top: 0,
                        width: 60, height: 200,
                        background: isPressed ? ACCENT.vocals : SURFACE,
                        color: isPressed ? '#fff' : INK_MUTED,
                        border: '1px solid ' + INK + '20',
                        borderRadius: '0 0 10px 10px',
                        boxShadow: isPressed
                          ? '0 1px 0 rgba(0,0,0,0.15)'
                          : '0 4px 0 rgba(0,0,0,0.05), inset 0 -2px 0 rgba(0,0,0,0.04)',
                        transform: isPressed ? 'translateY(2px)' : 'none',
                        transition: 'background .12s, transform .05s, box-shadow .05s',
                        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                        paddingBottom: 14, fontSize: 11, fontWeight: 500,
                        cursor: 'pointer',
                      }}>
                      {k.label}
                    </button>
                  );
                })}
                {/* black keys (overlay) */}
                {BLACK_KEYS.map((k) => {
                  const isPressed = pressed === k.midi;
                  return (
                    <button
                      key={k.midi}
                      onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); handlePress(k.midi); }}
                      aria-label={`${k.label} (${k.midi})`}
                      style={{
                        position: 'absolute', left: k.x, top: 0,
                        width: 36, height: 124,
                        background: isPressed ? ACCENT.vocals : INK,
                        color: isPressed ? INK : '#fff',
                        border: '1px solid ' + INK,
                        borderRadius: '0 0 6px 6px',
                        boxShadow: isPressed
                          ? '0 1px 0 rgba(0,0,0,0.25)'
                          : '0 4px 0 rgba(0,0,0,0.35), inset 0 -2px 0 rgba(255,255,255,0.05)',
                        transform: isPressed ? 'translateY(2px)' : 'none',
                        transition: 'background .12s, transform .05s, box-shadow .05s',
                        zIndex: 2, cursor: 'pointer',
                        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                        paddingBottom: 9, fontSize: 9, fontWeight: 500, letterSpacing: 0.2,
                      }}>
                      {k.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <div style={{ minHeight: 32, display: 'flex', alignItems: 'center', fontSize: 13 }}>
                {submitting && !error && (
                  <span style={{ color: INK_MUTED, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Spinner size={12} /> wird geprüft …
                  </span>
                )}
                {error && (
                  <span style={{
                    color: RED, background: RED + '12', padding: '8px 14px',
                    borderRadius: 999, fontWeight: 500,
                  }}>
                    {error}
                  </span>
                )}
              </div>
              {hasPinFallback && (
                <button onClick={onUsePin} style={{
                  background: 'none', border: 'none', padding: 0,
                  color: INK_MUTED, fontSize: 13, fontWeight: 500,
                  textDecoration: 'underline', textUnderlineOffset: 3,
                  cursor: 'pointer',
                }}>
                  Code statt Klavier →
                </button>
              )}
            </div>
          </div>

          <div style={{
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            gap: 8, fontSize: 12, color: INK_MUTED, marginTop: 18,
          }}>
            <span style={{ width: 6, height: 6, background: INK, transform: 'rotate(45deg)', display: 'inline-block' }} />
            powered by <span style={{ color: INK, fontWeight: 550 }}>schmalsoft solutions</span>
          </div>
        </div>
      </div>
    </div>
  );
}
