// Design tokens, stem definitions, and pure helpers.

export const ACCENT = {
  vocals: '#D946EF',
  drums:  '#2563EB',
  bass:   '#F5C518',
  piano:  '#10B981',
  synth:  '#8B5CF6',
  instr:  '#2563EB',
};
export const INK = '#171513';
export const INK_MUTED = '#6B6560';
export const BG = '#FAF7F2';
export const SURFACE = '#FFFFFF';
export const LINE = 'rgba(23,21,19,0.08)';
export const RED = '#C2410C';

// 2 Stems = 1 LALAL "vocals"-Task → Gesang + back_track (Instrumental)
// 4/5 Stems = ein paralleler Task pro LALAL-Stem
export const STEM_PRESET_META = {
  2: { title: 'Gesang + Inst.', sub: 'der Klassiker' },
  4: { title: 'Band',           sub: '+ Drums, Bass, Klavier' },
  5: { title: 'Studio',         sub: '+ Synth' },
};

export const STEMS_BY_COUNT = {
  2: [
    { id: 'vocals', label: 'Gesang',       color: ACCENT.vocals, glyph: 'G', api: 'vocals', source: 'stem' },
    { id: 'instr',  label: 'Instrumental', color: ACCENT.instr,  glyph: 'I', api: 'vocals', source: 'back' },
  ],
  4: [
    { id: 'vocals', label: 'Gesang',  color: ACCENT.vocals, glyph: 'G', api: 'vocals', source: 'stem' },
    { id: 'drums',  label: 'Drums',   color: ACCENT.drums,  glyph: 'D', api: 'drum',   source: 'stem' },
    { id: 'bass',   label: 'Bass',    color: ACCENT.bass,   glyph: 'B', api: 'bass',   source: 'stem' },
    { id: 'piano',  label: 'Klavier', color: ACCENT.synth,  glyph: 'K', api: 'piano',  source: 'stem' },
  ],
  5: [
    { id: 'vocals', label: 'Gesang',  color: ACCENT.vocals, glyph: 'G', api: 'vocals',      source: 'stem' },
    { id: 'drums',  label: 'Drums',   color: ACCENT.drums,  glyph: 'D', api: 'drum',        source: 'stem' },
    { id: 'bass',   label: 'Bass',    color: ACCENT.bass,   glyph: 'B', api: 'bass',        source: 'stem' },
    { id: 'piano',  label: 'Klavier', color: ACCENT.piano,  glyph: 'K', api: 'piano',       source: 'stem' },
    { id: 'synth',  label: 'Synth',   color: ACCENT.synth,  glyph: 'S', api: 'synthesizer', source: 'stem' },
  ],
};

export const fmtBytes = (n) => {
  if (n == null) return '–';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(n >= 10 || i === 0 ? 0 : 1) + ' ' + u[i];
};

export const fmtTime = (s) => {
  if (s == null || !isFinite(s)) return '–:––';
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
};

export const fmtSecs = (ms) => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
};

export const isMediaFile = (file) =>
  file.type.startsWith('audio/') ||
  file.type.startsWith('video/') ||
  /\.(mp3|wav|flac|ogg|m4a|aac|aiff|wma|mp4|mov|mkv|webm|avi)$/i.test(file.name);

export const downloadName = (srcName, label) => {
  const base = (srcName || 'track').replace(/\.[^.]+$/, '') || 'track';
  return `${base}__${label.toLowerCase().replace(/\s+/g, '_')}.mp3`;
};

export function rand(seed) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}
