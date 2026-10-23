import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import PortalLayout from '../components/PortalLayout';
import { childTestSa } from '../services/api';
import { urDigits, type Lang } from '../lib/assess/copy';
import { DASH_COPY } from '../lib/assess/dashboardCopy';
import { exampleCohort, TASKS, type DashStudent, type ReadLang, type TaskSpec } from '../lib/assess/exampleCohort';
import { masked, NO_SECTOR, secondVoiceCount, toDashStudents } from '../lib/assess/realCohort';
import { applyFilter, groupBy, headline, ORF_BANDS, summariseTask, type Filter } from '../lib/assess/cohortStats';
import { GRADES, rwpOrf } from '../lib/assess/rwpNorms';

/**
 * The results dashboard (/portal/leader/assess/dashboard): the example, sandbox only, or this tier's real sessions.
 *
 * Live (sa_real_dashboard, any tier, checked first): the coach's own sessions, or every coach's for a results admin
 * (GET …/sa/sessions), in the same layout under "Live data: N sessions"; no gender filter (the roster has none), and
 * a cell of 1–4 children shows "<5" and no numbers. A failed read says so and never falls back to the example.
 *
 * Behind sa_example_dashboard, which the server reports on only on the sandbox host (fail closed: off until the
 * switches answer, and when they cannot be read). It shows 1,000 synthetic students from a seeded generator in the
 * results API's own shape (lib/assess/exampleCohort.ts), bannered as example data; nothing is read from or written to
 * any session. A top summary, filters, a sub-region table that drills into schools, then one card per task with its
 * mean, zero scores, benchmark and distribution. 360 px first: tiles two across, the table scrolls inside its box.
 */

const LANG_KEY = 'niete-assess-lang';
const URDU_ROOT = '[font-family:var(--font-urdu)] [word-spacing:0.15em] [&_*]:leading-[2] [&_.text-xs]:text-sm';
const LRI = '⁦';
const PDI = '⁩';
/** One hue, light to dark, for the ordered reading bands (zero → fluent). */
const BAND_FILL = ['bg-sky-200', 'bg-sky-400', 'bg-sky-600', 'bg-sky-800'];

function readLang(): Lang {
  try { return window.localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'ur'; } catch { return 'ur'; }
}

type Load = 'loading' | 'off' | 'example' | 'live' | 'failed';

/** Which rule a task's card states under its chart. */
function ruleOf(spec: TaskSpec): 'items' | 'passage' | 'comprehension' | 'mathsItems' | 'fluency' {
  if (spec.kind === 'items') return spec.domain === 'ma' ? 'mathsItems' : 'items';
  return spec.kind;
}

export default function LeaderAssessDashboard() {
  const [lang, setLang] = useState<Lang>(readLang);
  const [load, setLoad] = useState<Load>('loading');
  const [filter, setFilter] = useState<Filter>({});
  const [read, setRead] = useState<ReadLang>('ur');
  const [real, setReal] = useState<DashStudent[]>([]);
  const c = DASH_COPY[lang];

  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => childTestSa.getSwitches())
      .then(async (s) => {
        if (!live) return;
        if (s && s.realDashboard === true) {
          try {
            const got = await childTestSa.getSessions();
            if (!live) return;
            setReal(toDashStudents((got && got.sessions) || []));
            setLoad('live');
          } catch {
            if (live) setLoad('failed');
          }
          return;
        }
        setLoad(s && s.exampleDashboard === true ? 'example' : 'off');
      })
      .catch(() => { if (live) setLoad('off'); });
    return () => { live = false; };
  }, []);

  const isLive = load === 'live';
  const cohort = useMemo(() => (load === 'example' ? exampleCohort() : load === 'live' ? real : []), [load, real]);
  const rows = useMemo(() => applyFilter(cohort, filter), [cohort, filter]);
  const h = useMemo(() => headline(rows), [rows]);
  const groups = useMemo(() => groupBy(rows, filter.sector ? 'school' : 'sector'), [rows, filter.sector]);
  const voices = useMemo(() => (isLive ? secondVoiceCount(rows) : 0), [isLive, rows]);

  const num = (n: number | string) => (lang === 'ur' ? `${LRI}${urDigits(n)}${PDI}` : String(n));
  const count = (n: number) => num(n.toLocaleString('en-US'));
  const pct = (x: number | null) => (x === null ? '–' : num(`${Math.round(x * 100)}%`));
  const one = (x: number | null) => (x === null ? '–' : num(Math.round(x * 10) / 10));
  // live data: a cell of 1–4 children shows "<5" and none of its numbers
  const hide = (n: number) => isLive && masked(n);
  const sectorName = (key: string) => (key === NO_SECTOR ? c.noSector : key);

  const switchLang = () => {
    const next: Lang = lang === 'ur' ? 'en' : 'ur';
    setLang(next);
    try { window.localStorage.setItem(LANG_KEY, next); } catch { /* per-device convenience only */ }
  };

  const header = (
    <div className="mb-4 flex items-center justify-between gap-2">
      <Link to="/portal/leader/assess" className="flex min-h-[48px] items-center gap-1 text-slate-700">
        <ChevronLeft className="h-5 w-5 rtl:rotate-180" aria-hidden /> {c.back}
      </Link>
      <h1 className="min-w-0 flex-1 text-center text-lg font-bold text-slate-900">{c.title}</h1>
      <button type="button" onClick={switchLang} className="min-h-[48px] rounded-full border border-slate-300 px-3 text-sm">{c.lang}</button>
    </div>
  );

  const chip = (testId: string, label: string, active: boolean, onClick: () => void) => (
    <button
      key={testId}
      type="button"
      data-testid={testId}
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-[40px] rounded-full border px-3 text-sm ${active ? 'border-sky-700 bg-sky-700 text-white' : 'border-slate-300 bg-white text-slate-800'}`}
    >{label}</button>
  );

  const tile = (testId: string, label: string, value: string, hint?: string) => (
    <div data-testid={testId} className="rounded-2xl border border-slate-200 bg-white p-3">
      <p className="text-xs text-slate-600">{label}</p>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );

  const distribution = (spec: TaskSpec, dist: number[], n: number) => {
    if (spec.kind === 'passage') {
      return (
        <div>
          <div className="flex h-6 w-full gap-[2px] overflow-hidden rounded" role="img" aria-label={ORF_BANDS.map((b, i) => `${c.bands[b.key]}: ${pct(n ? dist[i] / n : null)}`).join(', ')}>
            {ORF_BANDS.map((b, i) => (dist[i] ? (
              <div key={b.key} title={`${c.bands[b.key]}: ${pct(dist[i] / n)}`} className={BAND_FILL[i]} style={{ width: `${(dist[i] / n) * 100}%` }} />
            ) : null))}
          </div>
          <ul className="mt-2 grid grid-cols-2 gap-1 text-xs text-slate-700">
            {ORF_BANDS.map((b, i) => (
              <li key={b.key} className="flex items-center gap-1">
                <span className={`inline-block h-3 w-3 shrink-0 rounded-sm ${BAND_FILL[i]}`} aria-hidden />
                {c.bands[b.key]} · {pct(n ? dist[i] / n : null)}
              </li>
            ))}
          </ul>
        </div>
      );
    }
    const peak = Math.max(1, ...dist);
    return (
      <div>
        <div className="flex h-16 items-end gap-[2px]" role="img" aria-label={`${c.scoreAxis}: ${dist.map((v, k) => `${k} → ${v}`).join(', ')}`}>
          {dist.map((v, k) => (
            <div key={k} className="flex h-full min-w-0 flex-1 items-end" title={`${num(k)}: ${c.students_(count(v))}`}>
              <div className="w-full rounded-t bg-sky-600" style={{ height: `${Math.max(v ? 4 : 0, (v / peak) * 100)}%` }} />
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-[2px] text-[10px] text-slate-500" dir="ltr">
          {dist.length <= 9 ? dist.map((_, k) => <span key={k} className="flex-1 text-center">{num(k)}</span>) : (
            <><span className="flex-1">{num(0)}</span><span className="flex-1 text-end">{num(dist.length - 1)}</span></>
          )}
        </div>
        <p className="text-center text-xs text-slate-500">{c.scoreAxis}</p>
      </div>
    );
  };

  // the Rawalpindi May 2026 cohort's fluency for the grade in view (every grade when none is picked)
  const rwpReference = (domain: ReadLang) => (
    <div data-testid="dash-rwp" className="mt-3 rounded-xl bg-slate-50 p-2 text-xs text-slate-700">
      <p className="text-xs font-medium text-slate-800">{c.rwpTitle}</p>
      <ul>
        {(filter.grade ? [filter.grade] : GRADES).map((g) => {
          const r = rwpOrf(domain, g);
          return r ? (
            <li key={g} data-testid="dash-rwp-row">{c.grade(num(g))}: {c.rwpRow(one(r.median), one(r.p25), one(r.p75), pct(r.zero))}</li>
          ) : null;
        })}
      </ul>
      <p data-testid="dash-rwp-note" className="mt-1 text-xs text-slate-500">{c.rwpNote}</p>
    </div>
  );

  const taskCard = (spec: TaskSpec) => {
    const s = summariseTask(rows, spec);
    const rate = spec.kind === 'passage' || spec.kind === 'fluency';
    return (
      <li key={spec.taskId} data-testid={`dash-task-${spec.taskId}`} className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-base font-semibold text-slate-900">{c.tasks[spec.taskId]}</h3>
        <p dir="ltr" className="mb-2 text-start text-xs text-slate-500"><bdi>{spec.taskId}</bdi> · {c.of(num(spec.max))}</p>
        {hide(s.n) ? <p data-testid="dash-masked" className="mb-3 rounded-xl bg-slate-50 p-2 text-sm text-slate-600">{c.masked}</p> : (<>
        <dl className={`mb-3 grid ${s.benchmarkShare === null ? 'grid-cols-2' : 'grid-cols-3'} gap-2 text-center`}>
          <div><dt className="text-xs text-slate-600">{rate ? (spec.kind === 'passage' ? c.meanWpm : c.meanPerMin) : c.mean}</dt><dd className="font-bold text-slate-900">{rate ? one(s.meanValue) : pct(s.meanShare)}</dd></div>
          <div><dt className="text-xs text-slate-600">{c.zero}</dt><dd className="font-bold text-slate-900">{pct(s.zeroShare)}</dd></div>
          {s.benchmarkShare === null ? null : <div><dt className="text-xs text-slate-600">{c.met}</dt><dd className="font-bold text-slate-900">{pct(s.benchmarkShare)}</dd></div>}
        </dl>
        {distribution(spec, s.distribution, s.n)}
        </>)}
        {spec.kind === 'passage' ? rwpReference(spec.domain as ReadLang) : null}
        <p data-testid="dash-rule" className="mt-2 text-xs text-slate-500">{c.rules[ruleOf(spec)]}</p>
      </li>
    );
  };

  let body;
  if (load === 'loading') body = <p className="text-slate-600">{c.loading}</p>;
  else if (load === 'off') body = <p data-testid="dash-off" className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-700">{c.off}</p>;
  else if (load === 'failed') body = <p data-testid="dash-load-failed" role="alert" className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-700">{c.loadFailed}</p>;
  else if (isLive && !cohort.length) {
    body = (
      <div className="space-y-3">
        <p data-testid="dash-live" role="note" className="rounded-2xl border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900">{c.live(count(0))}</p>
        <p data-testid="dash-empty" className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-700">{c.empty}</p>
      </div>
    );
  } else {
    const hideAll = hide(h.n);
    const readTasks = TASKS.filter((t) => t.domain === read);
    const mathsTasks = TASKS.filter((t) => t.domain === 'ma');
    body = (
      <div className="space-y-5">
        {isLive
          ? <p data-testid="dash-live" role="note" className="rounded-2xl border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900">{c.live(count(cohort.length))}</p>
          : <p data-testid="dash-banner" role="note" className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{c.banner}</p>}
        {voices > 0 && <p data-testid="dash-second-voice" role="note" className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{c.secondVoice(count(voices), count(rows.length))}</p>}

        <section aria-label={c.filters} className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {chip('dash-read-ur', `${c.reading}: ${c.urdu}`, read === 'ur', () => setRead('ur'))}
            {chip('dash-read-en', `${c.reading}: ${c.english}`, read === 'en', () => setRead('en'))}
          </div>
          <div className="flex flex-wrap gap-2">
            {chip('dash-grade-all', c.allGrades, !filter.grade, () => setFilter((f) => ({ ...f, grade: null })))}
            {GRADES.map((g) => chip(`dash-grade-${g}`, c.grade(num(g)), filter.grade === g, () => setFilter((f) => ({ ...f, grade: g }))))}
            {isLive ? null : (<>
              {chip('dash-gender-all', c.allGenders, !filter.gender, () => setFilter((f) => ({ ...f, gender: null })))}
              {chip('dash-gender-girl', c.girls, filter.gender === 'girl', () => setFilter((f) => ({ ...f, gender: 'girl' })))}
              {chip('dash-gender-boy', c.boys, filter.gender === 'boy', () => setFilter((f) => ({ ...f, gender: 'boy' })))}
            </>)}
          </div>
        </section>

        <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {tile('dash-total', c.students, hideAll ? c.fewer : count(h.n))}
          {tile('dash-rwc', `${c.rwc} · ${read === 'ur' ? c.urdu : c.english}`, hideAll ? '–' : pct(h.readingWithComprehension[read]), hideAll ? c.masked : c.rwcHint)}
          {tile('dash-orf', `${c.orf} · ${read === 'ur' ? c.urdu : c.english}`, hideAll ? '–' : one(h.orfMedian[read]), hideAll ? undefined : c.orfZero(pct(h.orfZero[read])))}
          {tile('dash-maths', c.maths, hideAll ? '–' : pct(h.mathsAllMet), hideAll ? undefined : c.mathsHint)}
          {tile('dash-minutes', c.minutes, hideAll ? '–' : one(h.minutesMedian))}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">{filter.sector ? c.bySchool(sectorName(filter.sector)) : c.bySector}</h2>
            {filter.sector ? chip('dash-all-sectors', c.allSectors, false, () => setFilter((f) => ({ ...f, sector: null, schoolId: null }))) : null}
          </div>
          {!filter.sector ? <p className="mb-2 text-xs text-slate-500">{c.tapRow}</p> : null}
          <div className="overflow-x-auto">
            <table data-testid="dash-groups" className="w-full min-w-[300px] text-xs sm:text-sm">
              <thead>
                <tr className="text-xs text-slate-600">
                  <th className="py-1 text-start font-medium">{c.colArea}</th>
                  <th className="py-1 text-end font-medium">{c.colN}</th>
                  <th className="py-1 text-end font-medium">{c.colRwc}</th>
                  <th className="py-1 text-end font-medium">{c.colOrf}</th>
                  <th className="py-1 text-end font-medium">{c.colZero}</th>
                  <th className="py-1 text-end font-medium">{c.colMaths}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {groups.map((g) => (
                  <tr
                    key={g.key}
                    data-testid="dash-group-row"
                    data-key={g.key}
                    onClick={filter.sector ? undefined : () => setFilter((f) => ({ ...f, sector: g.key }))}
                    className={filter.sector ? '' : 'cursor-pointer hover:bg-sky-50'}
                  >
                    <td className="py-2 pe-1 text-slate-900">{filter.sector ? g.label.replace('Example school ', '') : sectorName(g.label)}</td>
                    <td className="py-2 text-end tabular-nums">{hide(g.n) ? c.fewer : count(g.n)}</td>
                    <td className="py-2 text-end tabular-nums">{hide(g.n) ? '–' : pct(g.h.readingWithComprehension[read])}</td>
                    <td className="py-2 text-end tabular-nums">{hide(g.n) ? '–' : one(g.h.orfMedian[read])}</td>
                    <td className="py-2 text-end tabular-nums">{hide(g.n) ? '–' : pct(g.h.orfZero[read])}</td>
                    <td className="py-2 text-end tabular-nums">{hide(g.n) ? '–' : pct(g.h.mathsAllMet)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-slate-900">{c.readingTasks(read === 'ur' ? c.urdu : c.english)}</h2>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{readTasks.map(taskCard)}</ul>
        </section>
        <section>
          <h2 className="mb-2 text-base font-semibold text-slate-900">{c.mathsTasks}</h2>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{mathsTasks.map(taskCard)}</ul>
        </section>

        <ul className="list-disc space-y-1 ps-5 text-xs text-slate-600">{(isLive ? c.liveNotes : c.notes).map((n) => <li key={n}>{n}</li>)}</ul>
      </div>
    );
  }

  return (
    <PortalLayout>
      <div dir={lang === 'ur' ? 'rtl' : 'ltr'} lang={lang} className={`mx-auto w-full max-w-5xl px-4 py-4 ${lang === 'ur' ? URDU_ROOT : ''}`}>
        {header}
        {body}
      </div>
    </PortalLayout>
  );
}
