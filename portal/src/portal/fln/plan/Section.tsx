/**
 * bd-t7zk3t.11 — a section as a disclosure band, CLOSED by default (OPERATOR DECISION, DESIGN v2 ruling 1).
 *
 * Closed: a 7 px stripe in the section colour on the inline-start side, the section's name, its minutes, the first
 * move on ONE line with an ellipsis, and ▾. The whole band header is one `<button aria-expanded aria-controls>` (≥64 px).
 * A tap expands it IN PLACE (▴) to its group headers and numbered moves; a tap again collapses it. No navigation, no
 * scrollIntoView: the band keeps its position and the page grows below it. The open state belongs to PlanPage (keyed
 * by section index) so it survives a sound playing and re-renders; expanding warms this section's clips.
 * Homework is a band too (`kind: 'homework'`, items without groups, no minutes).
 */
import { sectionClipIds, useWarmOnOpen } from '../player';
import { flnStrings, type FlnLang, type SectionKind } from '../strings';
import type { FlnGroup, FlnPlan } from '../types';
import { Move } from './Move';
import { Chrome, isolate, oneLine, ownNumbered } from './text';

export interface SectionProps {
  plan: FlnPlan;
  index: number;
  kind: SectionKind;
  minutes?: number;
  groups: FlnGroup[];
  open: boolean;
  onToggle: (index: number) => void;
  uiLang: FlnLang;
}

export function Section({ plan, index, kind, minutes, groups, open, onToggle, uiLang }: SectionProps) {
  const s = flnStrings(uiLang);
  const ps = flnStrings(plan.lang);
  const rtlUi = uiLang === 'ur';
  const prtl = plan.dir === 'rtl';
  const ids = sectionClipIds({ kind, groups });
  useWarmOnOpen(open, ids);
  const first = groups.flatMap((g) => g.items).find((it) => (it.text || '').trim());
  const panelId = `fln-sec-${plan.id}-${index}`;
  let n = 0;
  return (
    <section className={`fln-sec fln-c-${kind}${open ? ' fln-sec--open' : ''}`}>
      <h2 className="fln-sh">
        <button type="button" className="fln-band" data-fln-band={kind} aria-expanded={open} aria-controls={panelId} onClick={() => onToggle(index)}>
          <span className="fln-band-row">
            <span className="fln-band-title"><Chrome text={s.section[kind]} rtl={rtlUi} /></span>
            {minutes ? <span className="fln-band-min"><Chrome text={s.minutes(minutes)} rtl={rtlUi} /></span> : null}
            <span className="fln-chev" aria-hidden="true">{open ? '▴' : '▾'}</span>
          </span>
          {!open && first ? (
            <span className="fln-sum" lang={plan.lang} dir={plan.dir}>{isolate(oneLine(first.text), prtl)}</span>
          ) : null}
        </button>
      </h2>
      <div id={panelId} className="fln-sec-body" hidden={!open}>
        {open
          ? groups.map((g, gi) => (
            <div className="fln-grp" key={gi}>
              {g.header || g.level ? (
                <h3 lang={plan.lang} dir={plan.dir}>
                  {g.header ? <span>{isolate(g.header, prtl)}</span> : null}
                  {g.level ? <span className={`fln-lvl fln-lvl--${g.level}`}>{ps.groupLevel[g.level]}</span> : null}
                </h3>
              ) : null}
              {(() => {
                // A group whose steps carry their own numbers keeps the plan's numbers and gets no badges.
                const own = g.items.some((it) => ownNumbered(it.text));
                return g.items.map((it, ii) => {
                  if (!own) n += 1;
                  return <Move key={ii} item={it} n={own ? undefined : n} planLang={plan.lang} planDir={plan.dir} uiLang={uiLang} />;
                });
              })()}
            </div>
          ))
          : null}
      </div>
    </section>
  );
}
