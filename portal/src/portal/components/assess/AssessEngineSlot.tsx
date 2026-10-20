import { useEffect, useRef, useState } from 'react';
import { COPY, type Lang } from '../../lib/assess/copy';

/**
 * Where the child's test runs. For now a placeholder: the engine mounts here
 * later, behind the same props. The coach ends it with a press-and-hold (3 s)
 * so a child's tap cannot.
 */

const HOLD_MS = 3000;

type Props = { sessionId: string; firstName: string; lang: Lang; onFinished: () => void };

export function HoldButton({ label, hint, onDone }: { label: string; hint: string; onDone: () => void }) {
  const [progress, setProgress] = useState(0);
  const timer = useRef<number | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const stop = () => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
  };
  const cancel = () => { stop(); setProgress(0); };
  const begin = () => {
    if (timer.current !== null) return;
    const at = Date.now();
    timer.current = window.setInterval(() => {
      const p = Math.min(1, (Date.now() - at) / HOLD_MS);
      setProgress(p);
      if (p >= 1) { stop(); doneRef.current(); }
    }, 50);
  };
  useEffect(() => stop, []);

  return (
    <button
      type="button"
      aria-label={`${label} — ${hint}`}
      onPointerDown={begin}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); begin(); } }}
      onKeyUp={(e) => { if (e.key === 'Enter' || e.key === ' ') cancel(); }}
      onContextMenu={(e) => e.preventDefault()}
      className="relative w-full min-h-[56px] overflow-hidden rounded-2xl border border-slate-300 bg-white px-4 py-3 select-none touch-none"
    >
      <span aria-hidden className="absolute inset-y-0 start-0 bg-emerald-100" style={{ width: `${Math.round(progress * 100)}%` }} data-testid="hold-progress" />
      <span className="relative block text-lg font-semibold text-slate-900">{label}</span>
      <span className="relative block text-xs text-slate-600">{hint}</span>
    </button>
  );
}

export default function AssessEngineSlot({ sessionId, firstName, lang, onFinished }: Props) {
  const copy = COPY[lang];
  return (
    <div data-testid="assess-engine-slot" data-session={sessionId} className="space-y-6">
      <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-8 text-center">
        <p className="text-2xl font-bold text-slate-900">{copy.engineHere}</p>
        <p className="mt-2 text-slate-600">{firstName}</p>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{copy.coachOnly}</p>
        <HoldButton label={copy.holdFinished} hint={copy.holdHint} onDone={onFinished} />
      </div>
    </div>
  );
}
