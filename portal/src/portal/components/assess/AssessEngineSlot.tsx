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
 *
 * With hand-back v2 (sa_handback_v2), the engine's sa:battery_end turns the hold
 * into a full-width "Next child (coach)": every task is done, so completing it
 * finishes the child as complete, and nothing after the end can read as coach_end. When the engine first says
 * sa:battery_ending (its last answers are still going to the server), the hold shows disabled as "Sending…" until
 * sa:battery_end, or for 20 s at most (offline: the rows stay queued on the phone and go later).
 */

const HOLD_MS = 3000;

export type FinishReason = 'done' | 'complete' | 'coach_end' | 'handback' | 'offline' | 'not_started';
const COACH_END_WAIT_MS = 3000;
const SENDING_MAX_MS = 20_000;

type Props = {
  sessionId: string;
  firstName: string;
  lang: Lang;
  grade: number;
  block: Block;
  onFinished: (reason: FinishReason) => void;
  handbackV2?: boolean;
  /** sa_voice_gate_v2: after the engine's sa:refused, the hold ends the child as not_started, never coach_end. */
  voiceGateV2?: boolean;
  /** sa_end_test_restart (round 7b): End test is one tap and a short question, not a 3 s hold. */
  endTestRestart?: boolean;
  /** sa_end_section (round 7b): RDF manual shows End this section (sa:end_section to the engine; the test goes on). */
  endSection?: boolean;
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

export function HoldButton({ label, hint, onDone, compact = false, disabled = false }: { label: string; hint: string; onDone: () => void; compact?: boolean; disabled?: boolean }) {
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
    if (disabled || timer.current !== null) return;
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
      disabled={disabled}
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
        : 'relative w-full min-h-[56px] overflow-hidden rounded-2xl border border-slate-300 bg-white px-4 py-3 select-none touch-none disabled:opacity-60'}
    >
      <span aria-hidden className="absolute inset-y-0 start-0 bg-emerald-100" style={{ width: `${Math.round(progress * 100)}%` }} data-testid="hold-progress" />
      <span className={`relative block font-semibold text-slate-900 ${compact ? 'text-xs' : 'text-lg'}`}>{label}</span>
      {!compact && <span className="relative block text-xs text-slate-600">{hint}</span>}
    </button>
  );
}

export default function AssessEngineSlot({ sessionId, firstName, lang, grade, block, onFinished, handbackV2 = false, voiceGateV2 = false, endTestRestart = false, endSection = false }: Props) {
  const copy = COPY[lang];
  const frame = useRef<HTMLIFrameElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const loadedOnce = useRef(false);
  const ended = useRef(false);
  const doneRef = useRef(onFinished);
  doneRef.current = onFinished;
  const [src] = useState(() => playUrl(sessionId, grade, lang, block, firstName));
  /** running → ending (sa:battery_ending: the last answers are being sent) → ended (sa:battery_end). */
  const [batteryEnded, setBatteryEnded] = useState<'running' | 'ending' | 'ended'>('running');
  const batteryEndedRef = useRef(false);

  const finish = (reason: FinishReason) => {
    if (ended.current) return;
    ended.current = true;
    doneRef.current(reason);
  };

  // The hold asks the engine to end the run, so the running task's result says coach_end and is flushed;
  // an engine that does not answer within 3 s is left anyway.
  const coachEnding = useRef<number | null>(null);
  // the engine refused to start (its voice was not ready): the child never began, so nothing is asked of the engine
  const refusedRef = useRef(false);
  const coachEnd = () => {
    if (batteryEndedRef.current) { finish('complete'); return; }
    if (refusedRef.current) { finish('not_started'); return; }
    if (ended.current || coachEnding.current !== null) return;
    try {
      frame.current?.contentWindow?.postMessage({ type: 'sa:coach_end', s: sessionId }, window.location.origin);
    } catch { /* no engine to ask */ }
    coachEnding.current = window.setTimeout(() => finish(batteryEndedRef.current ? 'complete' : 'coach_end'), COACH_END_WAIT_MS);
  };
  useEffect(() => () => { if (coachEnding.current !== null) window.clearTimeout(coachEnding.current); }, []);

  // Round 7b: the coach's question before End test (sa_end_test_restart) or End this section (sa_end_section, RDF manual)
  const [ask, setAsk] = useState<'end' | 'section' | null>(null);
  const sectionButton = endSection && block === 'rdf_manual';
  const endSectionNow = () => {
    setAsk(null);
    try {
      frame.current?.contentWindow?.postMessage({ type: 'sa:end_section', s: sessionId }, window.location.origin);
    } catch { /* no engine to ask */ }
  };

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: unknown; s?: unknown; reason?: unknown } | null;
      if (e.origin !== window.location.origin || !d || d.s !== sessionId) return;
      if ((d.type === 'sa:battery_end' || d.type === 'sa:battery_ending') && handbackV2) {
        batteryEndedRef.current = true;
        if (d.type === 'sa:battery_end') setBatteryEnded('ended');
        else setBatteryEnded((p) => (p === 'running' ? 'ending' : p));
        return;
      }
      if ((d.type === 'sa:refused' || d.type === 'sa:unrefused') && voiceGateV2) {
        refusedRef.current = d.type === 'sa:refused';
        return;
      }
      if (d.type !== 'sa:done') return;
      if (batteryEndedRef.current) { finish('complete'); return; }
      if (coachEnding.current !== null) { finish('coach_end'); return; }
      finish(d.reason === 'complete' || d.reason === 'coach_end' ? d.reason : 'done');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [sessionId, handbackV2, voiceGateV2]);

  // a battery_end that never comes (offline, a lost message) does not keep the coach waiting
  useEffect(() => {
    if (batteryEnded !== 'ending') return undefined;
    const t = window.setTimeout(() => setBatteryEnded('ended'), SENDING_MAX_MS);
    return () => window.clearTimeout(t);
  }, [batteryEnded]);

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
      {batteryEnded !== 'running' ? (
        <div data-testid="assess-hold-next" className="fixed inset-x-4 bottom-4 mx-auto max-w-md" style={{ zIndex: 1001 }}>
          <HoldButton label={copy.holdNext} hint={batteryEnded === 'ending' ? copy.holdSending : copy.holdNextHint}
            disabled={batteryEnded === 'ending'} onDone={coachEnd} />
        </div>
      ) : (
        // top-start: the engine's full-width bottom buttons and its top-end dev Jump and sync dot stay clear
        <div data-testid="assess-hold-end" className="fixed top-2 start-2 flex gap-2" style={{ zIndex: 1001 }}>
          {endTestRestart ? (
            <button type="button" data-testid="assess-end-test" onClick={() => setAsk('end')}
              className="min-h-[48px] min-w-[48px] rounded-xl border border-slate-300 bg-white/90 px-3 py-1 text-xs font-semibold text-slate-900">
              {copy.holdEnd}
            </button>
          ) : (
            <HoldButton compact label={copy.holdEnd} hint={copy.holdHint} onDone={coachEnd} />
          )}
          {sectionButton && (
            <button type="button" data-testid="assess-end-section" onClick={() => setAsk('section')}
              className="min-h-[48px] min-w-[48px] rounded-xl border border-slate-300 bg-white/90 px-3 py-1 text-xs font-semibold text-slate-900">
              {copy.endSection}
            </button>
          )}
        </div>
      )}
      {ask && (
        <div className="fixed inset-0 flex items-center justify-center bg-slate-900/40 p-4" style={{ zIndex: 1002 }}>
          <div role="dialog" aria-modal="true" data-testid={`assess-ask-${ask}`} className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-4 shadow-lg">
            <p className="text-base text-slate-900 break-words">{ask === 'end' ? copy.endTestAsk(firstName) : copy.endSectionAsk}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setAsk(null)} className="min-h-[48px] flex-1 rounded-xl border border-slate-300 bg-white font-medium">{copy.keepGoing}</button>
              <button type="button" onClick={ask === 'end' ? () => { setAsk(null); coachEnd(); } : endSectionNow}
                className="min-h-[48px] flex-1 rounded-xl bg-rose-600 font-semibold text-white">{ask === 'end' ? copy.endTestYes : copy.endSectionYes}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
