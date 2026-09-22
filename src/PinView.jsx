// 4-digit PIN gate, OTP-style. Each digit lives in its own cell that
// auto-advances on input, supports backspace navigation and paste.

import { useState, useEffect, useRef, useCallback } from 'react';
import { ACCENT, INK, INK_MUTED, BG, SURFACE, LINE, RED } from './tokens.js';
import { Logo, Spinner } from './components.jsx';
import { authenticate, ApiError } from './api.js';
import { playDtmf, playSuccess, playFail } from './synth.js';

export default function PinView({ length = 4, hasRhythmFallback, onAuthed, onUseRhythm }) {
  const [digits, setDigits] = useState(Array(length).fill(''));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [shake, setShake] = useState(false);
  const [scale, setScale] = useState(1);
  const inputsRef = useRef([]);

  useEffect(() => {
    const fit = () => {
      const sx = window.innerWidth  / 1280;
      const sy = window.innerHeight / 800;
      setScale(Math.min(sx, sy, 1));
    };
    fit();
    window.addEventListener('resize', fit);
    inputsRef.current[0]?.focus();
    return () => window.removeEventListener('resize', fit);
  }, []);

  // auto-dismiss the error pill after 3 s
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 3000);
    return () => clearTimeout(t);
  }, [error]);

  const submitPin = useCallback(async (pin) => {
    setSubmitting(true);
    try {
      await authenticate({ pin });
      playSuccess();
      setTimeout(() => onAuthed(), 320);
    } catch (e) {
      const msg = e instanceof ApiError && e.status === 429
        ? (e.message || 'Zu viele Versuche — kurz warten.')
        : 'falscher Code.';
      setError(msg);
      playFail();
      setShake(true);
      setTimeout(() => {
        setShake(false);
        setDigits(Array(length).fill(''));
        setSubmitting(false);
        inputsRef.current[0]?.focus();
      }, 600);
    }
  }, [onAuthed, length]);

  const writeDigit = useCallback((idx, digit) => {
    if (submitting || !/^\d$/.test(digit)) return;
    setError(null);
    playDtmf(digit);
    setDigits((prev) => {
      const next = [...prev];
      next[idx] = digit;
      const nextIdx = Math.min(idx + 1, length - 1);
      // advance focus *after* state update commits
      requestAnimationFrame(() => inputsRef.current[nextIdx]?.focus());
      if (next.every((d) => d !== '')) {
        setTimeout(() => submitPin(next.join('')), 220);
      }
      return next;
    });
  }, [submitting, length, submitPin]);

  const handleChange = (idx) => (e) => {
    const v = e.target.value;
    // user typed → take last char (covers iOS auto-fill + general overwrite)
    const digit = v.slice(-1);
    if (digit === '') {
      setDigits((prev) => { const next = [...prev]; next[idx] = ''; return next; });
      return;
    }
    writeDigit(idx, digit);
  };

  const handleKeyDown = (idx) => (e) => {
    if (submitting) { e.preventDefault(); return; }
    if (e.key === 'Backspace') {
      // empty cell → step back and clear previous
      if (!digits[idx] && idx > 0) {
        e.preventDefault();
        const prevIdx = idx - 1;
        setDigits((prev) => { const next = [...prev]; next[prevIdx] = ''; return next; });
        requestAnimationFrame(() => inputsRef.current[prevIdx]?.focus());
      }
    } else if (e.key === 'ArrowLeft' && idx > 0) {
      e.preventDefault();
      inputsRef.current[idx - 1]?.focus();
    } else if (e.key === 'ArrowRight' && idx < length - 1) {
      e.preventDefault();
      inputsRef.current[idx + 1]?.focus();
    } else if (/^\d$/.test(e.key) && digits[idx]) {
      // overwrite a filled cell when the user types another digit
      e.preventDefault();
      writeDigit(idx, e.key);
    }
  };

  const handlePaste = (e) => {
    const txt = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, length);
    if (!txt.length) return;
    e.preventDefault();
    const next = Array(length).fill('');
    for (let i = 0; i < txt.length; i++) next[i] = txt[i];
    setDigits(next);
    setError(null);
    const focusIdx = Math.min(txt.length, length - 1);
    requestAnimationFrame(() => inputsRef.current[focusIdx]?.focus());
    if (txt.length === length) setTimeout(() => submitPin(txt), 220);
  };

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
            alignItems: 'center', justifyContent: 'center', gap: 32,
          }}>
            <div style={{ textAlign: 'center' }}>
              <h1 style={{
                margin: 0,
                fontFamily: '"Space Grotesk", system-ui, sans-serif',
                fontSize: 42, fontWeight: 600, letterSpacing: -1.6, lineHeight: 1.05, color: INK,
              }}>
                Code <span style={{ color: ACCENT.vocals, fontStyle: 'italic' }}>bitte</span>.
              </h1>
              <div style={{ fontSize: 14, color: INK_MUTED, marginTop: 8 }}>
                {length} Ziffern.
              </div>
            </div>

            {/* OTP-style input cells */}
            <div style={{
              display: 'flex', gap: 12,
              animation: shake ? 'hfShake 0.5s' : 'none',
            }}>
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => (inputsRef.current[i] = el)}
                  className="pin-cell"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="one-time-code"
                  maxLength={1}
                  value={d}
                  disabled={submitting}
                  onChange={handleChange(i)}
                  onKeyDown={handleKeyDown(i)}
                  onPaste={i === 0 ? handlePaste : undefined}
                  onFocus={(e) => e.target.select()}
                  style={{
                    width: 64, height: 80,
                    background: SURFACE,
                    border: '1.5px solid ' + LINE,
                    borderRadius: 12,
                    color: INK,
                    fontFamily: '"Space Grotesk", system-ui, sans-serif',
                    fontSize: 32, fontWeight: 600,
                    textAlign: 'center',
                    outline: 'none',
                    transition: 'border-color .15s, box-shadow .15s',
                    fontVariantNumeric: 'tabular-nums',
                    caretColor: ACCENT.vocals,
                  }}
                />
              ))}
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
              {hasRhythmFallback && (
                <button onClick={onUseRhythm} style={{
                  background: 'none', border: 'none', padding: 0,
                  color: INK_MUTED, fontSize: 13, fontWeight: 500,
                  textDecoration: 'underline', textUnderlineOffset: 3,
                  cursor: 'pointer',
                }}>
                  Klavier statt Code →
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
