// Visual atoms — Logo, pills, buttons, chip, waveform, stems picker.

import { useState, useEffect, useRef, useMemo } from 'react';
import { ACCENT, INK, INK_MUTED, SURFACE, LINE, rand, STEMS_BY_COUNT, STEM_PRESET_META } from './tokens.js';

export function Logo({ size = 22 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{
        width: size + 8, height: size + 8, borderRadius: 8, background: INK,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <div style={{ width: 2.5, height: 8,  background: ACCENT.vocals, borderRadius: 1 }} />
          <div style={{ width: 2.5, height: 14, background: '#fff',         borderRadius: 1 }} />
          <div style={{ width: 2.5, height: 6,  background: ACCENT.vocals, borderRadius: 1 }} />
          <div style={{ width: 2.5, height: 11, background: '#fff',         borderRadius: 1 }} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{
          fontFamily: '"Space Grotesk", "Inter Tight", system-ui, sans-serif',
          fontSize: size, fontWeight: 600, letterSpacing: -0.6, color: INK,
        }}>schmalal</span>
        <span style={{ fontSize: size * 0.58, color: INK_MUTED, fontWeight: 450 }}>
          tracks splitten.
        </span>
      </div>
    </div>
  );
}

export function Pill({ children, onClick, active, style, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '7px 12px', borderRadius: 999,
        border: '1px solid ' + (active ? INK : LINE),
        background: active ? INK : SURFACE,
        color: active ? '#fff' : INK,
        fontSize: 13, fontWeight: 550, cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        ...style,
      }}>
      {children}
    </button>
  );
}

export function Button({ children, primary, small, onClick, style, disabled, type }) {
  return (
    <button
      type={type || 'button'}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: small ? '8px 14px' : '12px 20px',
        fontSize: small ? 13 : 14, fontWeight: 550, letterSpacing: -0.1,
        border: '1px solid ' + (primary ? INK : LINE),
        background: primary ? INK : SURFACE,
        color: primary ? '#fff' : INK,
        borderRadius: 999, cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        ...style,
      }}>
      {children}
    </button>
  );
}

export function IconButton({ children, active, color, title, size = 32, onClick, disabled }) {
  return (
    <button onClick={onClick} title={title} disabled={disabled} style={{
      width: size, height: size, borderRadius: '50%',
      border: active ? `1.5px solid ${color || INK}` : '1px solid ' + LINE,
      background: active ? (color || INK) : SURFACE,
      color: active ? '#fff' : INK_MUTED,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 11, fontWeight: 600, letterSpacing: 0.3,
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
    }}>
      {children}
    </button>
  );
}

export function Chip({ color, label }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '5px 11px', borderRadius: 999, background: SURFACE,
      border: `1px solid ${color}40`,
      fontSize: 12, fontWeight: 550, color: INK,
      boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
    }}>
      <div style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
      {label}
    </div>
  );
}

export function Waveform({ width = 480, height = 44, color = INK, density = 96, seed = 1, progress = null, dim = false, onSeek }) {
  const bars = useMemo(() => {
    const out = [];
    const r = rand(seed);
    for (let i = 0; i < density; i++) {
      const env = 0.4 + 0.6 * Math.abs(Math.sin(i / density * Math.PI * 2.2 + seed));
      out.push((0.18 + r() * 0.82) * env * height);
    }
    return out;
  }, [seed, density, height]);

  const bw = width / density;
  const playedIdx = progress != null ? Math.floor(progress * density) : -1;

  const handleClick = onSeek ? (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onSeek((e.clientX - rect.left) / rect.width);
  } : undefined;

  return (
    <svg
      width={width} height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ display: 'block', cursor: onSeek ? 'pointer' : 'default' }}
      onClick={handleClick}
    >
      {bars.map((h, i) => {
        const upcoming = progress != null && i > playedIdx;
        let fill = color;
        if (dim) fill = 'rgba(23,21,19,0.18)';
        else if (upcoming) fill = `${color}40`;
        return (
          <rect
            key={i}
            x={i * bw + 0.5}
            y={(height - h) / 2}
            width={Math.max(1.4, bw - 1.6)}
            height={Math.max(2, h)}
            fill={fill}
            rx={1}
          />
        );
      })}
    </svg>
  );
}

// Three big preset cards — primary control for choosing which stems we
// extract. Replaces the old top-right "X Stems" pill.
export function StemPresetCards({ value, onChange, disabled }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12,
      opacity: disabled ? 0.55 : 1,
      pointerEvents: disabled ? 'none' : 'auto',
    }}>
      {[2, 4, 5].map((count) => (
        <StemPresetCard
          key={count}
          count={count}
          active={value === count}
          onSelect={() => onChange(count)}
        />
      ))}
    </div>
  );
}

function StemPresetCard({ count, active, onSelect }) {
  const stems = STEMS_BY_COUNT[count];
  const meta = STEM_PRESET_META[count];
  return (
    <button
      onClick={onSelect}
      style={{
        position: 'relative',
        padding: '14px 16px 16px',
        borderRadius: 14,
        background: SURFACE,
        border: '1.5px solid ' + (active ? ACCENT.vocals : LINE),
        boxShadow: active
          ? '0 0 0 4px rgba(217,70,239,0.12), 0 4px 14px rgba(0,0,0,0.04)'
          : '0 1px 0 rgba(0,0,0,0.02)',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'border-color .15s, box-shadow .15s, transform .05s',
        transform: active ? 'translateY(-1px)' : 'none',
      }}
    >
      <div style={{ display: 'flex', gap: 5, marginBottom: 12 }}>
        {stems.map((s) => (
          <span key={s.id} style={{
            width: 9, height: 9, borderRadius: '50%', background: s.color,
          }} />
        ))}
      </div>
      <div style={{
        fontFamily: '"Space Grotesk", system-ui, sans-serif',
        fontSize: 18, fontWeight: 600, letterSpacing: -0.3, color: INK,
      }}>
        {meta.title}
      </div>
      <div style={{ fontSize: 12, color: INK_MUTED, marginTop: 3 }}>
        {meta.sub}
      </div>
    </button>
  );
}

export function Frame({ children }) {
  // 1280×800 page that scales to fit the viewport, like the design.
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
        background: '#FAF7F2',
      }}>
        {children}
      </div>
    </div>
  );
}

export function Spinner({ size = 16, color = INK }) {
  return (
    <span style={{
      display: 'inline-block',
      width: size, height: size, borderRadius: '50%',
      border: `2px solid ${color}40`, borderTopColor: color,
      animation: 'hfSpin 0.8s linear infinite',
    }} />
  );
}
