import { useEffect, useState } from 'react';
import type { AssessCopy } from '../../lib/assess/copy';
import { mmss, VISIT_LIMIT_MS } from '../../lib/assess/visitStore';

/**
 * The visit at a glance, stuck to the top of the list and the handover: children
 * done of five, the time used against 45 minutes (from the first Present), and
 * where each finished child's test is (on this phone, sending, or sent), and
 * which children are on another phone.
 */

export type SyncItem = { drawId: string; name: string; state: 'phone' | 'sending' | 'sent' | 'other' };

type Props = { copy: AssessCopy; done: number; total: number; startedAt: number | null; sync: SyncItem[] };

export default function AssessVisitBar({ copy, done, total, startedAt, sync }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return undefined;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [startedAt]);

  const used = startedAt === null ? 0 : now - startedAt;
  const over = used > VISIT_LIMIT_MS;
  return (
    <div data-testid="assess-visit-bar" className="sticky top-0 z-10 mb-4 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm font-medium">
        <span className="text-slate-900">{copy.childrenDone(done, total)}</span>
        <span className={over ? 'text-red-700' : 'text-slate-700'}>{copy.timeUsed(mmss(used), mmss(VISIT_LIMIT_MS))}</span>
      </div>
      {sync.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-1 text-xs">
          {sync.map((s) => (
            <li key={s.drawId} data-state={s.state} className={`rounded-full px-2 py-0.5 ${s.state === 'sent' ? 'bg-emerald-100 text-emerald-800' : s.state === 'sending' || s.state === 'other' ? 'bg-sky-100 text-sky-800' : 'bg-amber-100 text-amber-900'}`}>
              {s.name} · {s.state === 'sent' ? copy.sent : s.state === 'sending' ? copy.sending : s.state === 'other' ? copy.onOtherPhone : copy.onPhone}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
