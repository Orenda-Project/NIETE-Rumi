/**
 * The lesson goal (the first SLO) and "Full details ▾", which expands IN PLACE (the v10 mechanism) to
 * every SLO, Bring (resources), Before class (setup items, with their pictures) and Summary. Reference fields only;
 * the steps are the lesson, so they live in the section bands.
 */
import { useState } from 'react';
import { flnStrings, type FlnLang } from '../strings';
import type { FlnPlan } from '../types';
import { Move } from './Move';
import { Chrome, PlanText } from './text';

export function Details({ plan, uiLang }: { plan: FlnPlan; uiLang: FlnLang }) {
  const s = flnStrings(uiLang);
  const [open, setOpen] = useState(false);
  const rtlUi = uiLang === 'ur';
  const prtl = plan.dir === 'rtl';
  const slo = (plan.slo || []).filter(Boolean);
  const setup = plan.setup || [];
  const summary = plan.summary || [];
  const resources = (plan.resources || []).filter(Boolean);
  const hasMore = slo.length > 1 || resources.length > 0 || setup.length > 0 || summary.length > 0;
  if (!slo.length && !hasMore) return null;
  const id = `fln-details-${plan.id}`;
  return (
    <div className="fln-goal">
      <div className="fln-goal-l">{s.goal}</div>
      {slo[0] ? <p className="fln-goal-p" lang={plan.lang} dir={plan.dir}><PlanText text={slo[0]} rtl={prtl} /></p> : null}
      {hasMore ? (
        <button type="button" className="fln-more" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
          {open ? s.fewerDetails : s.fullDetails} <span aria-hidden="true">{open ? '▴' : '▾'}</span>
        </button>
      ) : null}
      <div id={id} className="fln-details" hidden={!open}>
        {open ? (
          <>
            {slo.length ? (
              <>
                <h4><Chrome text={s.details.slo} rtl={rtlUi} /></h4>
                <ul lang={plan.lang} dir={plan.dir}>{slo.map((x, i) => <li key={i}><PlanText text={x} rtl={prtl} /></li>)}</ul>
              </>
            ) : null}
            {resources.length ? (
              <>
                <h4><Chrome text={s.details.bring} rtl={rtlUi} /></h4>
                <ul lang={plan.lang} dir={plan.dir}>{resources.map((x, i) => <li key={i}><PlanText text={x} rtl={prtl} /></li>)}</ul>
              </>
            ) : null}
            {setup.length ? (
              <>
                <h4><Chrome text={s.details.before} rtl={rtlUi} /></h4>
                {setup.map((it, i) => <Move key={i} item={it} planLang={plan.lang} planDir={plan.dir} uiLang={uiLang} />)}
              </>
            ) : null}
            {summary.length ? (
              <>
                <h4><Chrome text={s.details.summary} rtl={rtlUi} /></h4>
                {summary.map((it, i) => <Move key={i} item={it} planLang={plan.lang} planDir={plan.dir} uiLang={uiLang} />)}
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
