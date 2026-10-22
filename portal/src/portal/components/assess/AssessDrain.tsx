import { useEffect, useRef } from 'react';

export const DRAIN_SRC = '/sa/play.html?drain=1&embed=1';
const DRAIN_MAX_MS = 60_000;

/**
 * A hidden same-origin frame on the engine's drain mode: it sends every session this phone still holds
 * (a child whose network came back after the hand-back, when that child's own engine page was gone).
 * Done on `sa:drained`, or after 60 s whatever happened.
 */
export type Drained = { s: string; pending: number }[];

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** One session of the engine's answer: rows (events, results) and recordings still on the phone. */
function pendingOf(x: unknown): { s: string; pending: number } | null {
  const o = x as { s?: unknown; pending?: unknown; pending_events?: unknown; pending_audio?: unknown } | null;
  if (!o || typeof o.s !== 'string') return null;
  return { s: o.s, pending: typeof o.pending === 'number' ? o.pending : num(o.pending_events) + num(o.pending_audio) };
}

export default function AssessDrain({ onDone }: { onDone: (sessions: Drained) => void }) {
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    let over = false;
    const end = (sessions: Drained = []) => { if (!over) { over = true; doneRef.current(sessions); } };
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: unknown; sessions?: unknown } | null;
      if (e.origin !== window.location.origin || !d || d.type !== 'sa:drained') return;
      const list = Array.isArray(d.sessions) ? d.sessions : [];
      end(list.map(pendingOf).filter((x): x is { s: string; pending: number } => x !== null));
    };
    window.addEventListener('message', onMessage);
    const t = window.setTimeout(() => end(), DRAIN_MAX_MS);
    return () => { over = true; window.removeEventListener('message', onMessage); window.clearTimeout(t); };
  }, []);
  return (
    <iframe data-testid="assess-drain-frame" src={DRAIN_SRC} title="sync" aria-hidden="true" tabIndex={-1}
      className="pointer-events-none fixed h-px w-px opacity-0" style={{ left: -10, top: -10, border: 0 }} />
  );
}
