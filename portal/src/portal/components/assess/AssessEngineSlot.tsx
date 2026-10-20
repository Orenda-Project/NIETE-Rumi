import { useEffect, useRef, useState } from 'react';
import { COPY, type Lang } from '../../lib/assess/copy';
import type { Block } from '../../lib/assess/blocks';
import { keepScreenOn } from '../../lib/keepAwake';

/**
 * Where the child's test runs: the SA engine's play page in a full-screen,
 * same-origin frame (embed=1). The engine does its own handover and hand-back;
 * the child is done when it posts sa:done, when the frame lands on the handback
 * URL, or when the frame cannot be read after it has loaded (an offline error
 * page). A small corner hold (3 s) lets the coach end early. The first name goes
 * only in the URL fragment, which never reaches a server.
 */

const HOLD_MS = 3000;

export type FinishReason = 'done' | 'complete' | 'coach_end' | 'handback' | 'offline';

type Props = {
  sessionId: string;
  firstName: string;
  lang: Lang;
  grade: number;
  block: Block;
  onFinished: (reason: FinishReason) => void;
};

export function playUrl(s: string, grade: number, lang: Lang, block: Block, firstName: string): string {
  const q = new URLSearchParams({
    s,
    form: `sa.coach.G${grade}.A.${lang}`,
    mode: 'proctored',
    lang,
    block,
    embed: '1',
    back: `/sa/play.html?handback=${s}`,
  });
  return `/sa/play.html?${q.toString()}#n=${encodeURIComponent(firstName)}`;
}

export function HoldButton({ label, hint, onDone, compact = false }: { label: string; hint: string; onDone: () => void; compact?: boolean }) {
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
      className={compact
        ? 'relative min-h-[48px] min-w-[48px] overflow-hidden rounded-xl border border-slate-300 bg-white/90 px-3 py-1 select-none touch-none'
        : 'relative w-full min-h-[56px] overflow-hidden rounded-2xl border border-slate-300 bg-white px-4 py-3 select-none touch-none'}
    >
      <span aria-hidden className="absolute inset-y-0 start-0 bg-emerald-100" style={{ width: `${Math.round(progress * 100)}%` }} data-testid="hold-progress" />
      <span className={`relative block font-semibold text-slate-900 ${compact ? 'text-xs' : 'text-lg'}`}>{label}</span>
      {!compact && <span className="relative block text-xs text-slate-600">{hint}</span>}
    </button>
  );
}

export default function AssessEngineSlot({ sessionId, firstName, lang, grade, block, onFinished }: Props) {
  const copy = COPY[lang];
  const frame = useRef<HTMLIFrameElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const loadedOnce = useRef(false);
  const ended = useRef(false);
  const doneRef = useRef(onFinished);
  doneRef.current = onFinished;
  const [src] = useState(() => playUrl(sessionId, grade, lang, block, firstName));

  const finish = (reason: FinishReason) => {
    if (ended.current) return;
    ended.current = true;
    doneRef.current(reason);
  };

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: unknown; s?: unknown; reason?: unknown } | null;
      if (e.origin !== window.location.origin || !d || d.type !== 'sa:done' || d.s !== sessionId) return;
      finish(d.reason === 'complete' || d.reason === 'coach_end' ? d.reason : 'done');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [sessionId]);

  useEffect(() => {
    let release: (() => Promise<void>) | null = null;
    let live = true;
    Promise.resolve()
      .then(() => keepScreenOn())
      .then((r) => { if (live) release = r; else void r?.(); })
      .catch(() => { /* the engine also holds the screen */ });
    return () => { live = false; void release?.().catch(() => {}); };
  }, []);

  // Full screen is the page's: a frame allowed full screen goes to the top layer, over the coach's hold.
  // Start's tap is still the active gesture when this mounts.
  useEffect(() => {
    const el = slot.current;
    try {
      const r = el?.requestFullscreen?.();
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch { /* not allowed here; the engine still runs */ }
    return () => {
      if (el && document.fullscreenElement === el) {
        try { void document.exitFullscreen?.().catch(() => {}); } catch { /* already out */ }
      }
    };
  }, []);

  const onLoad = () => {
    let search: string;
    try {
      search = String(frame.current?.contentWindow?.location.search ?? '');
    } catch {
      if (loadedOnce.current) finish('offline');
      loadedOnce.current = true;
      return;
    }
    loadedOnce.current = true;
    if (new URLSearchParams(search).get('handback') === sessionId) finish('handback');
  };

  return (
    <div ref={slot} data-testid="assess-engine-slot" data-session={sessionId}>
      <iframe
        ref={frame}
        data-testid="assess-engine-frame"
        title={copy.engineTitle}
        src={src}
        allow="microphone; screen-wake-lock; autoplay"
        onLoad={onLoad}
        className="fixed inset-0 h-full w-full border-0 bg-white"
        style={{ zIndex: 1000 }}
      />
      <div className="fixed bottom-2 end-2" style={{ zIndex: 1001 }}>
        <HoldButton compact label={copy.holdEnd} hint={copy.holdHint} onDone={() => finish('coach_end')} />
      </div>
    </div>
  );
}
