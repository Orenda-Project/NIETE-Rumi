import { useEffect, useRef } from 'react';

export const DRAIN_SRC = '/sa/play.html?drain=1&embed=1';
/** No new server answer and no upload bytes for this long: the drain is stuck, end it. */
export const DRAIN_IDLE_MS = 30_000;
/** A frame that has not reported progress yet (an engine older than sa-47 never does): today's cap. */
export const DRAIN_SILENT_MS = 60_000;
/** Never longer than this, however it moves. */
export const DRAIN_MAX_MS = 10 * 60_000;

/**
 * A hidden same-origin frame on the engine's drain mode: it sends every session this phone still holds
 * (a child whose network came back after the hand-back, when that child's own engine page was gone).
 * Done on `sa:drained`, or after 30 s without progress (the frame's `sa:drain_progress`: a server answer, or bytes
 * of an upload sent), or at 10 minutes. A slow upload that is moving is not cut. Until the frame first reports
 * progress the cap stays 60 s, so this page is safe beside an engine that does not report it.
 */
export type Drained = { s: string; pending: number }[];

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** One session of the engine's answer: rows (events, results) and recordings still on the phone. */
function pendingOf(x: unknown): { s: string; pending: number } | null {
  const o = x as { s?: unknown; pending?: unknown; pending_events?: unknown; pending_audio?: unknown } | null;
  if (!o || typeof o.s !== 'string') return null;
  return { s: o.s, pending: typeof o.pending === 'number' ? o.pending : num(o.pending_events) + num(o.pending_audio) };
}

/** onDone(sessions, answered): answered false when the page's own clock ended it (no sa:drained), so what the phone
 *  holds is not known. */
export default function AssessDrain({ onDone }: { onDone: (sessions: Drained, answered: boolean) => void }) {
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    let over = false;
    const end = (sessions: Drained = [], answered = false) => { if (!over) { over = true; doneRef.current(sessions, answered); } };
    let idle = window.setTimeout(() => end(), DRAIN_SILENT_MS);
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: unknown; sessions?: unknown } | null;
      if (e.origin !== window.location.origin || !d) return;
      if (d.type === 'sa:drain_progress') {
        window.clearTimeout(idle);
        idle = window.setTimeout(() => end(), DRAIN_IDLE_MS);
        return;
      }
      if (d.type !== 'sa:drained') return;
      const list = Array.isArray(d.sessions) ? d.sessions : [];
      end(list.map(pendingOf).filter((x): x is { s: string; pending: number } => x !== null), true);
    };
    window.addEventListener('message', onMessage);
    const t = window.setTimeout(() => end(), DRAIN_MAX_MS);
    return () => { over = true; window.removeEventListener('message', onMessage); window.clearTimeout(t); window.clearTimeout(idle); };
  }, []);
  return (
    <iframe data-testid="assess-drain-frame" src={DRAIN_SRC} title="sync" aria-hidden="true" tabIndex={-1}
      className="pointer-events-none fixed h-px w-px opacity-0" style={{ left: -10, top: -10, border: 0 }} />
  );
}
