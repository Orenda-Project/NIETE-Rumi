/**
 * bd-t7zk3t.11 — the time bar (DESIGN v2 §2 S4.3, the v10 pattern): one coloured segment per section sized by its
 * minutes, the minutes inside («۵ منٹ» on an Urdu page — never a ′ mark), the section names under it.
 */
import { flnStrings, type FlnLang } from '../strings';
import type { FlnPlan } from '../types';
import { Chrome } from './text';

export function TimeBar({ plan, uiLang }: { plan: FlnPlan; uiLang: FlnLang }) {
  const s = flnStrings(uiLang);
  const rtl = uiLang === 'ur';
  const segs = plan.sections
    .map((sec) => ({ kind: sec.kind, minutes: sec.minutes ?? plan.minutes[sec.kind] ?? 0 }))
    .filter((x) => x.minutes > 0);
  if (!segs.length) return null;
  return (
    <div className="fln-timebar-wrap">
      <div className="fln-timebar" role="img" aria-label={segs.map((x) => `${s.section[x.kind]} ${s.minutes(x.minutes)}`).join(s.sep)}>
        {segs.map((x) => (
          <span key={x.kind} className={`fln-timebar-seg fln-c-${x.kind}`} style={{ flexGrow: x.minutes, flexBasis: 0 }}>
            <span><Chrome text={s.minutes(x.minutes)} rtl={rtl} /></span>
          </span>
        ))}
      </div>
      <div className="fln-timebar-lab" aria-hidden="true">
        {segs.map((x) => <span key={x.kind} style={{ flexGrow: x.minutes, flexBasis: 0 }}>{s.section[x.kind]}</span>)}
      </div>
    </div>
  );
}
