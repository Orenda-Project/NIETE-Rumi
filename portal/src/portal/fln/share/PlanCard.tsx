/**
 * The plan as both Share sheets show it: a navy card, the kicker (subject — level — lesson n/N, in the
 * chrome's language) and the title in the PLAN's language and direction. Numbers come from the placement row, never
 * from `seq` (DESIGN v2 decision 10).
 */
import { Fill } from './Fill';
import { shareStrings, type ShareLang, type ShareSubject } from './strings.share';

export interface SharePlan {
  id: number;
  title: string;
  lang: ShareLang;
  dir: 'ltr' | 'rtl';
  subject: ShareSubject;
  level: number;
  pos?: number | null;
  count?: number | null;
  minutes?: number | null;
}

const SUBJECTS: ReadonlySet<string> = new Set(['rh-en', 'rh-ur', 'num']);

function minutesOf(m: unknown): number | null {
  if (typeof m === "number") return m;
  if (m && typeof m === "object" && typeof (m as { total?: unknown }).total === "number") return (m as { total: number }).total;
  return null;
}

/** `{plan, placement}` (m-app's FlnPlanResponse, or this file's structural types) → what the sheets need; null when unusable. */
export function sharePlanOf(data: unknown): SharePlan | null {
  const d = (data || {}) as { plan?: Record<string, unknown> | null; placement?: Array<Record<string, unknown>> };
  const p = d.plan;
  if (!p || typeof p !== 'object') return null;
  const id = Number(p.id);
  const place = Array.isArray(d.placement) && d.placement.length ? d.placement[0] : null;
  const subject = String((place && place.subject) || p.subject || '');
  const level = Number(place && place.level);
  if (!Number.isInteger(id) || id <= 0 || typeof p.title !== 'string' || !SUBJECTS.has(subject) || !(level >= 1 && level <= 3)) return null;
  return {
    id,
    title: p.title,
    lang: p.lang === 'ur' ? 'ur' : 'en',
    dir: p.dir === 'rtl' ? 'rtl' : 'ltr',
    subject: subject as ShareSubject,
    level,
    pos: place && typeof place.pos === 'number' ? place.pos : null,
    count: place && typeof place.count === 'number' ? place.count : null,
    minutes: minutesOf(p.minutes),
  };
}

export function Kicker({ plan, lang }: { plan: SharePlan; lang: ShareLang }) {
  const S = shareStrings(lang);
  const lesson = plan.pos && plan.count && plan.pos > 0;
  return (
    <span className="block text-[13px] font-bold uppercase tracking-[0.06em] text-[#47BA7D] rtl:normal-case rtl:tracking-normal">
      {S.subject[plan.subject]}
      {/* Each separator stays with the part after it, so a wrapped kicker never ends a line on «·» / «—». */}
      {' '}<span className="whitespace-nowrap">{S.sep.trimStart()}<Fill text={S.level} values={{ n: plan.level }} lang={lang} /></span>
      {lesson ? (
        <>
          {' '}
          <span className="whitespace-nowrap">
          {S.sep.trimStart()}
          <Fill text={S.lesson} values={{ pos: plan.pos as number, count: plan.count as number }} lang={lang} />
          </span>
        </>
      ) : null}
    </span>
  );
}

export function PlanCard({ plan, lang }: { plan: SharePlan; lang: ShareLang }) {
  return (
    <div data-testid="fln-share-plan-card" className="rounded-[16px] bg-[#333748] px-4 py-3 text-white">
      <Kicker plan={plan} lang={lang} />
      <p lang={plan.lang} dir={plan.dir} className="mt-1 text-[18px] font-bold leading-snug">{plan.title}</p>
    </div>
  );
}
