// Auth gate dispatcher: ask /api/me on mount, render the right gate
// (rhythm-keyboard or PIN-keypad) until authed, then mount the App.
// Re-prompts when an API call later returns 401.

import { useState, useEffect, useCallback } from 'react';
import { INK, INK_MUTED, BG, SURFACE, LINE } from './tokens.js';
import { Spinner } from './components.jsx';
import { getMe, logout } from './api.js';
import KeyboardView from './KeyboardView.jsx';
import PinView from './PinView.jsx';
import App from './App.jsx';

export default function Root() {
  // status:
  //   { kind: 'loading' }
  //   { kind: 'rhythm', rhythmLength, hasPin }
  //   { kind: 'pin', pinLength, hasRhythm }
  //   { kind: 'ok' }
  //   { kind: 'error', message }
  const [status, setStatus] = useState({ kind: 'loading' });
  const [gated, setGated] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const me = await getMe();
      const gates = me.gates || {};
      setGated(!!(gates.rhythm || gates.pin));
      if (me.authed) {
        setStatus({ kind: 'ok' });
      } else if (gates.rhythm) {
        setStatus({
          kind: 'rhythm',
          rhythmLength: gates.rhythm_length || 3,
          hasPin: !!gates.pin,
          pinLength: gates.pin_length || 4,
        });
      } else if (gates.pin) {
        setStatus({
          kind: 'pin',
          pinLength: gates.pin_length || 4,
          hasRhythm: false,
        });
      } else {
        setStatus({ kind: 'ok' });
      }
    } catch (e) {
      setStatus({ kind: 'error', message: e.message || 'Backend nicht erreichbar.' });
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (status.kind === 'loading') {
    return <FullPageMessage><Spinner size={20} /> &nbsp;Lade …</FullPageMessage>;
  }
  if (status.kind === 'error') {
    return (
      <FullPageMessage>
        <div>Backend nicht erreichbar.</div>
        <div style={{ fontSize: 12, color: INK_MUTED, marginTop: 6 }}>{status.message}</div>
      </FullPageMessage>
    );
  }
  if (status.kind === 'rhythm') {
    return (
      <KeyboardView
        length={status.rhythmLength}
        hasPinFallback={status.hasPin}
        onAuthed={() => setStatus({ kind: 'ok' })}
        onUsePin={() => setStatus({ kind: 'pin', pinLength: status.pinLength, hasRhythm: true })}
      />
    );
  }
  if (status.kind === 'pin') {
    return (
      <PinView
        length={status.pinLength}
        hasRhythmFallback={status.hasRhythm}
        onAuthed={() => setStatus({ kind: 'ok' })}
        onUseRhythm={() => refresh()}
      />
    );
  }
  return (
    <App
      gated={gated}
      onAuthExpired={() => refresh()}
      onLogout={async () => { await logout(); refresh(); }}
    />
  );
}

function FullPageMessage({ children }) {
  return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: BG,
    }}>
      <div style={{
        padding: '24px 28px', borderRadius: 16,
        background: SURFACE, border: '1px solid ' + LINE,
        display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 14, color: INK,
      }}>
        {children}
      </div>
    </div>
  );
}
