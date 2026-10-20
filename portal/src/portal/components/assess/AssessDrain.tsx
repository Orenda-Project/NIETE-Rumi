import { useEffect, useRef } from 'react';

export const DRAIN_SRC = '/sa/play.html?drain=1&embed=1';
const DRAIN_MAX_MS = 60_000;

/**
 * A hidden same-origin frame on the engine's drain mode: it sends every session this phone still holds
 * (a child whose network came back after the hand-back, when that child's own engine page was gone).
 * Done on `sa:drained`, or after 60 s whatever happened.
 */
export type Drained = { s: string; pending: number }[];

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
      end(list.filter((x): x is { s: string; pending: number } => Boolean(x) && typeof x.s === 'string' && typeof x.pending === 'number')
        .map((x) => ({ s: x.s, pending: x.pending })));
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
