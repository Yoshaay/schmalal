// Tiny piano-ish synth via Web Audio API.
// Lazy-initialised AudioContext (browsers require a user gesture before audio).

let ctxSingleton = null;

export function getAudioContext() {
  if (!ctxSingleton) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctxSingleton = new Ctor();
  }
  if (ctxSingleton.state === 'suspended') ctxSingleton.resume();
  return ctxSingleton;
}

export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Plucked-piano-ish single note. Two oscillators + closing lowpass + AD envelope.
export function playNote(midi, durationSec = 0.7) {
  const ctx = getAudioContext();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const f = midiToFreq(midi);

  const o1 = ctx.createOscillator();
  o1.type = 'triangle';
  o1.frequency.value = f;

  const o2 = ctx.createOscillator();
  o2.type = 'sine';
  o2.frequency.value = f * 2.005;  // slight detune for chorus

  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.Q.value = 1;
  filt.frequency.setValueAtTime(Math.min(8000, f * 8), t0);
  filt.frequency.exponentialRampToValueAtTime(Math.max(400, f * 1.5), t0 + durationSec);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(0.32, t0 + 0.005);          // attack
  env.gain.exponentialRampToValueAtTime(0.14, t0 + 0.1);       // initial decay
  env.gain.exponentialRampToValueAtTime(0.001, t0 + durationSec); // release

  o1.connect(filt);
  o2.connect(filt);
  filt.connect(env);
  env.connect(ctx.destination);

  o1.start(t0); o2.start(t0);
  o1.stop(t0 + durationSec); o2.stop(t0 + durationSec);
}

// Tiny success chime — perfect 5th up, two short blips.
export function playSuccess() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  [
    { f: 660, at: t0,        d: 0.18, gain: 0.22 },
    { f: 990, at: t0 + 0.12, d: 0.30, gain: 0.22 },
  ].forEach(({ f, at, d, gain }) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, at + d);
    o.connect(g).connect(ctx.destination);
    o.start(at); o.stop(at + d);
  });
}

// DTMF (touch-tone phone) frequencies. Two simultaneous sines per digit.
const DTMF = {
  '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
  '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
  '7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
                    '0': [941, 1336],
};

export function playDtmf(digit, durationSec = 0.13) {
  const ctx = getAudioContext();
  if (!ctx) return;
  const tones = DTMF[String(digit)];
  if (!tones) return;
  const t0 = ctx.currentTime;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(0.18, t0 + 0.005);
  env.gain.exponentialRampToValueAtTime(0.001, t0 + durationSec);
  env.connect(ctx.destination);
  tones.forEach((f) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    o.connect(env);
    o.start(t0);
    o.stop(t0 + durationSec);
  });
}

// Buzzy reject sound.
export function playFail() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(220, t0);
  o.frequency.exponentialRampToValueAtTime(140, t0 + 0.3);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.18, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.32);
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = 1200;
  o.connect(filt).connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + 0.35);
}
