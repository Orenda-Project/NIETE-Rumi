import { useEffect, useState } from 'react';

/**
 * bd-5rz1v / bd-5rz1v.26 — small pieces of the record-and-send page, shared by today's page
 * (pages/PortalCoachingRecord) and the new UI's (newui/coaching/RecordPage). Moved here unchanged.
 */

/** "Lesson 3 Oct 09.05.webm" — the name a recording made here is sent under. */
export function lessonFilename(ext: string, at = new Date()): string {
  const d = at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const t = `${String(at.getHours()).padStart(2, '0')}.${String(at.getMinutes()).padStart(2, '0')}`;
  return `Lesson ${d} ${t}${ext}`;
}

/** A live 0..1 microphone level, or null where Web Audio is unavailable. */
export function useMicLevel(stream: MediaStream | null, active: boolean): number | null {
  const [level, setLevel] = useState<number | null>(null);
  useEffect(() => {
    if (!stream || !active) return undefined;
    const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return undefined;
    let ctx: AudioContext | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    try {
      ctx = new Ctx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      timer = setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i += 1) { const v = (buf[i] - 128) / 128; sum += v * v; }
        setLevel(Math.sqrt(sum / buf.length));
      }, 120);
    } catch {
      setLevel(null);
    }
    return () => {
      if (timer) clearInterval(timer);
      try { void ctx?.close(); } catch { /* closed */ }
    };
  }, [stream, active]);
  return level;
}

/** A page of this app behind this one in the browser's history (React Router's own index). */
export function hasHistoryBehind(): boolean {
  try {
    const idx = (window.history.state as { idx?: unknown } | null)?.idx;
    return typeof idx === 'number' && idx > 0;
  } catch {
    return false;
  }
}
