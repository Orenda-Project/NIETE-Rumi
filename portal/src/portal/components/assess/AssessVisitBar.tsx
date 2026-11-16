import { useEffect, useState } from 'react';
import type { AssessCopy } from '../../lib/assess/copy';
import { mmss } from '../../lib/assess/visitStore';

/**
 * The visit at a glance, stuck to the top of the list and the handover: the time used against
 * the visit's limit (from the first Present), big, under a label that says it is the whole
 * visit's time for its `kids` children (not one child's); children done of the list; where each
 * finished child's test is (on this phone, sending, or sent), and which children are on another phone.
 */

export type SyncItem = { drawId: string; name: string; state: 'phone' | 'sending' | 'audio' | 'sent' | 'other' };

type Props = { copy: AssessCopy; done: number; total: number; kids: number; startedAt: number | null; limitMs: number; sync: SyncItem[] };

export default function AssessVisitBar({ copy, done, total, kids, startedAt, limitMs, sync }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return undefined;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [startedAt]);

  const used = startedAt === null ? 0 : now - startedAt;
  const over = used > limitMs;
  return (
    <div data-testid="assess-visit-bar" className="sticky top-0 z-10 mb-4 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 backdrop-blur">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p id="assess-visit-time-label" data-testid="assess-visit-time-label" className="text-sm font-semibold text-slate-700">{copy.visitTime(kids)}</p>
          <p data-testid="assess-visit-clock" role="timer" aria-labelledby="assess-visit-time-label"
            className={`text-3xl font-bold leading-tight tabular-nums ${over ? 'text-red-700' : 'text-slate-900'}`}>{copy.visitClock(mmss(used), mmss(limitMs))}</p>
        </div>
        <span className="pb-1 text-sm font-medium text-slate-900">{copy.childrenDone(done, total)}</span>
      </div>
      {sync.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-1 text-xs">
          {sync.map((s) => (
            <li key={s.drawId} data-state={s.state} className={`rounded-full px-2 py-0.5 ${s.state === 'sent' ? 'bg-emerald-100 text-emerald-800' : s.state === 'sending' || s.state === 'audio' || s.state === 'other' ? 'bg-sky-100 text-sky-800' : 'bg-amber-100 text-amber-900'}`}>
              {s.name} · {s.state === 'sent' ? copy.sent : s.state === 'sending' ? copy.sending : s.state === 'audio' ? copy.audioWaiting : s.state === 'other' ? copy.onOtherPhoneChip : copy.onPhone}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
