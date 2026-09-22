// useStemPlayer — load all stems as parallel HTMLAudioElements,
// keep them transport-synced, expose mute/solo/seek to the UI.

import { useState, useEffect, useRef, useCallback } from 'react';

export function useStemPlayer(stems) {
  const [isPlaying, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState({});
  const [solo, setSolo] = useState(null);
  const [ready, setReady] = useState(false);
  const audiosRef = useRef({});

  useEffect(() => {
    Object.values(audiosRef.current).forEach((a) => {
      try { a.pause(); a.removeAttribute('src'); a.load(); } catch (_) {}
    });
    audiosRef.current = {};
    setProgress(0); setDuration(0); setPlaying(false); setMuted({}); setSolo(null); setReady(false);

    if (!stems || !stems.length) return;
    const valid = stems.filter((s) => s.downloadUrl);
    if (!valid.length) return;

    valid.forEach((s) => {
      const a = new Audio();
      a.preload = 'auto';
      a.src = s.downloadUrl;
      a.addEventListener('ended', () => {
        setPlaying(false);
        Object.values(audiosRef.current).forEach((x) => { try { x.currentTime = 0; } catch (_) {} });
        setProgress(0);
      });
      audiosRef.current[s.id] = a;
    });

    const driver = audiosRef.current[valid[0].id];
    const onLoaded = () => { setDuration(driver.duration || 0); setReady(true); };
    const onTime = () => { if (driver.duration > 0) setProgress(driver.currentTime / driver.duration); };
    driver.addEventListener('loadedmetadata', onLoaded);
    driver.addEventListener('timeupdate', onTime);
    if (driver.readyState >= 1) onLoaded();

    return () => {
      driver.removeEventListener('loadedmetadata', onLoaded);
      driver.removeEventListener('timeupdate', onTime);
      Object.values(audiosRef.current).forEach((a) => {
        try { a.pause(); a.removeAttribute('src'); a.load(); } catch (_) {}
      });
    };
  }, [stems]);

  useEffect(() => {
    Object.entries(audiosRef.current).forEach(([id, a]) => {
      if (solo) a.muted = id !== solo;
      else a.muted = !!muted[id];
    });
  }, [muted, solo]);

  const play = useCallback(() => {
    const audios = Object.values(audiosRef.current);
    if (!audios.length) return;
    const t = audios[0].currentTime || 0;
    audios.forEach((a) => { try { a.currentTime = t; } catch (_) {} });
    Promise.all(audios.map((a) => a.play().catch(() => {}))).then(() => setPlaying(true));
  }, []);

  const pause = useCallback(() => {
    Object.values(audiosRef.current).forEach((a) => a.pause());
    setPlaying(false);
  }, []);

  const toggle = useCallback(() => { isPlaying ? pause() : play(); }, [isPlaying, play, pause]);

  const seek = useCallback((frac) => {
    const audios = Object.values(audiosRef.current);
    if (!audios.length || !audios[0].duration) return;
    const t = Math.max(0, Math.min(1, frac)) * audios[0].duration;
    audios.forEach((a) => { try { a.currentTime = t; } catch (_) {} });
    setProgress(t / audios[0].duration);
  }, []);

  const toggleMute = useCallback((id) => setMuted((m) => ({ ...m, [id]: !m[id] })), []);
  const toggleSolo = useCallback((id) => setSolo((s) => s === id ? null : id), []);

  return { isPlaying, progress, duration, muted, solo, ready, toggle, seek, toggleMute, toggleSolo };
}
