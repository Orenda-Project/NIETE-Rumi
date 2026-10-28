import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import PortalLayout from '../components/PortalLayout';
import { childTestSa } from '../services/api';
import { urDigits, type Lang } from '../lib/assess/copy';
import { useUrFit } from '../lib/assess/urFit';
import { DASH_COPY, DASH_CWPM } from '../lib/assess/dashboardCopy';
import { exampleCohort, TASKS, type DashStudent, type ReadLang, type TaskSpec } from '../lib/assess/exampleCohort';
import { masked, NO_SECTOR, pktWhen, secondVoiceCount, toDashStudents, withPractice } from '../lib/assess/realCohort';
import type { SaDashboardSession } from '../types/childTestSa';
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
 *
 * Round 7b, live only, behind sa_dash_filters (switches.dashFilters): a coach-led / auto filter, date from–to (Pakistan
 * days) and a coach picker (a results admin sees every coach) that apply across the board; and "Skips and stops": every
 * skip and stop (back, end section, end test, restart, silence repeat, under-20% move-on) by type and by coach, heaviest
 * first, and each one listed, honouring the same filters. A session with a stop but no task yet (stopSessions) counts in
 * the stops view only, never in the results. Off: the page is as before.
 *
 * Round 8, live only, when the server answers practiceFilter (sa_r8_hide_practice): sessions in practice (SIM) schools
 * are left out of everything by default, and one toggle, "Include practice schools", adds them back.
 */
// Amendment 1: the completion rule's incomplete_move_on replaced under20_move_on; an old under20_move_on still lists
const STOP_TYPES = ['back', 'end_section', 'end_test', 'restart', 'silence_repeat', 'incomplete_move_on'] as const;
const LISTED_STOPS = [...STOP_TYPES, 'under20_move_on'];
const STOPS_SHOWN = 300;

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
  useUrFit();
  const [lang, setLang] = useState<Lang>(readLang);
  const [load, setLoad] = useState<Load>('loading');
  const [filter, setFilter] = useState<Filter>({});
  const [read, setRead] = useState<ReadLang>('ur');
  const [got, setGot] = useState<{ sessions: SaDashboardSession[]; stopSessions: SaDashboardSession[] }>({ sessions: [], stopSessions: [] });
  // sa_dash_filters (round 7b): the filters and the stops view; the sessions with a stop and no task yet
  const [dashOn, setDashOn] = useState(false);
  // sa_r8_hide_practice (round 8): the server marks practice-school rows; they count only when asked for
  const [practiceFilter, setPracticeFilter] = useState(false);
  const [includePractice, setIncludePractice] = useState(false);
  // sa_cwpm (round 7b item 14): every words-per-minute number is labelled CWPM, with its formula
  const [cwpm, setCwpm] = useState(false);
  const c = cwpm ? { ...DASH_COPY[lang], ...DASH_CWPM[lang] } : DASH_COPY[lang];

  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => childTestSa.getSwitches())
      .then(async (s) => {
        if (!live) return;
        if (s && s.cwpm === true) setCwpm(true);
        if (s && s.realDashboard === true) {
          try {
            const answer = await childTestSa.getSessions();
            if (!live) return;
            const dash = s.dashFilters === true;
            setGot({ sessions: (answer && answer.sessions) || [], stopSessions: (dash && answer && answer.stopSessions) || [] });
            if (dash) setDashOn(true);
            if (answer && answer.practiceFilter === true) setPracticeFilter(true);
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

  const counted = !practiceFilter || includePractice;
  const real = useMemo(() => toDashStudents(withPractice(got.sessions, counted)), [got, counted]);
  const stopOnly = useMemo(() => toDashStudents(withPractice(got.stopSessions, counted)), [got, counted]);
  const practiceHidden = counted ? 0 : [...got.sessions, ...got.stopSessions].filter((x) => x.practice === true).length;
  const isLive = load === 'live';
  const cohort = useMemo(() => (load === 'example' ? exampleCohort() : load === 'live' ? real : []), [load, real]);
  const rows = useMemo(() => applyFilter(cohort, filter), [cohort, filter]);
  const h = useMemo(() => headline(rows), [rows]);
  const groups = useMemo(() => groupBy(rows, filter.sector ? 'school' : 'sector'), [rows, filter.sector]);
  const voices = useMemo(() => (isLive ? secondVoiceCount(rows) : 0), [isLive, rows]);
  const filtersOn = isLive && dashOn;
  // every coach in the data, by name (a coach's own view has one: no picker)
  const coaches = useMemo(() => {
    const seen = new Map<string, string | null>();
    for (const s of [...cohort, ...stopOnly]) if (s.coachId && !seen.has(s.coachId)) seen.set(s.coachId, s.coachName ?? null);
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => (a.name || '~').localeCompare(b.name || '~'));
  }, [cohort, stopOnly]);
  // the stops view: the filtered sessions plus the filtered sessions with a stop and no task yet
  const stopRows = useMemo(() => (filtersOn ? [...rows, ...applyFilter(stopOnly, filter)] : []), [filtersOn, rows, stopOnly, filter]);
  const stopsView = useMemo(() => {
    const totals = Object.fromEntries(STOP_TYPES.map((t) => [t, 0])) as Record<string, number>;
    const byCoach = new Map<string, { id: string; name: string | null; sessions: number; counts: Record<string, number>; total: number }>();
    const items: { key: string; at: string | null; type: string; taskId: string | null; by: string | null; s: DashStudent }[] = [];
    for (const s of stopRows) {
      const id = s.coachId || '';
      if (!byCoach.has(id)) byCoach.set(id, { id, name: s.coachName ?? null, sessions: 0, counts: Object.fromEntries(STOP_TYPES.map((t) => [t, 0])), total: 0 });
      const k = byCoach.get(id)!;
      k.sessions += 1;
      (s.stops || []).forEach((st, i) => {
        if (!LISTED_STOPS.includes(st.type)) return;
        if ((STOP_TYPES as readonly string[]).includes(st.type)) {
          totals[st.type] += 1;
          k.counts[st.type] += 1;
          k.total += 1;
        }
        items.push({ key: `${s.id}-${i}`, at: st.at, type: st.type, taskId: st.taskId, by: st.by, s });
      });
    }
    const coachRows = [...byCoach.values()].sort((a, b) => (b.total - a.total) || ((b.total / b.sessions) - (a.total / a.sessions)) || (a.name || '~').localeCompare(b.name || '~'));
    items.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    return { totals, coachRows, items };
  }, [stopRows]);
  const narrowed = Boolean(filter.mode || filter.coachId || filter.from || filter.to);
  // item 15: each child tested (the same filtered sessions as the stops view) from the random draw or added by the coach
  const originView = useMemo(() => {
    const totals = { drawn: 0, added: 0, unknown: 0 };
    const byCoach = new Map<string, { id: string; name: string | null; drawn: number; added: number; unknown: number }>();
    for (const s of stopRows) {
      const id = s.coachId || '';
      if (!byCoach.has(id)) byCoach.set(id, { id, name: s.coachName ?? null, drawn: 0, added: 0, unknown: 0 });
      const k = byCoach.get(id)!;
      const o = s.origin === 'added' ? 'added' : s.origin === 'drawn' ? 'drawn' : 'unknown';
      totals[o] += 1;
      k[o] += 1;
    }
    const share = (k: { drawn: number; added: number }) => (k.drawn + k.added ? k.added / (k.drawn + k.added) : 0);
    const rows = [...byCoach.values()].sort((a, b) => (share(b) - share(a)) || (b.added - a.added) || (a.name || '~').localeCompare(b.name || '~'));
    return { totals, rows, share };
  }, [stopRows]);

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

  const practiceToggle = practiceFilter ? (
    <div className="space-y-1 rounded-2xl border border-slate-200 bg-white p-3">
      <label className="flex min-h-[40px] items-center gap-2 text-sm text-slate-800">
        <input type="checkbox" data-testid="dash-include-practice" checked={includePractice} onChange={(e) => setIncludePractice(e.target.checked)} className="h-5 w-5" />
        {c.includePractice}
      </label>
      {practiceHidden ? <p data-testid="dash-practice-hidden" className="text-xs text-slate-500">{c.practiceHidden(count(practiceHidden))}</p> : null}
    </div>
  ) : null;

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

  // a reading task names its language (Letter names are in both); maths needs none
  const taskName = (taskId: string) => {
    const title = c.tasks[taskId] || taskId;
    const domain = taskId.slice(0, 2);
    return domain === 'ur' ? `${title} (${c.urdu})` : domain === 'en' ? `${title} (${c.english})` : title;
  };
  const stopsSection = (
    <section data-testid="dash-stops" aria-label={c.stopsTitle} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{c.stopsTitle}</h2>
        <p className="text-xs text-slate-500">{c.stopsHint}</p>
      </div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {STOP_TYPES.map((t) => (
          <li key={t} data-testid={`dash-stop-total-${t}`} className="rounded-xl bg-slate-50 p-2">
            <p className="text-xs text-slate-600">{c.stopTypes[t]}</p>
            <p className="text-xl font-bold text-slate-900">{count(stopsView.totals[t])}</p>
          </li>
        ))}
      </ul>
      {stopsView.items.length === 0 ? <p data-testid="dash-stops-none" className="rounded-xl bg-slate-50 p-2 text-sm text-slate-700">{c.stopsNone}</p> : null}
      {stopsView.coachRows.length ? (
        <div className="overflow-x-auto">
          <table data-testid="dash-stops-by-coach" className="w-full min-w-[560px] text-xs sm:text-sm">
            <thead>
              <tr className="text-xs text-slate-600">
                <th className="px-2 py-1 text-start font-medium">{c.colCoach}</th>
                <th className="whitespace-nowrap px-2 py-1 text-end font-medium">{c.colSessions}</th>
                {STOP_TYPES.map((t) => <th key={t} className="whitespace-nowrap px-2 py-1 text-end font-medium">{c.stopTypes[t]}</th>)}
                <th className="whitespace-nowrap px-2 py-1 text-end font-medium">{c.colTotal}</th>
                <th className="whitespace-nowrap px-2 py-1 text-end font-medium">{c.colPerSession}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {stopsView.coachRows.map((k) => (
                <tr key={k.id || 'none'} data-testid="dash-stops-coach-row" data-coach={k.id} data-total={k.total} data-sessions={k.sessions}>
                  <td className="px-2 py-2 text-slate-900"><bdi>{k.name || c.unknownCoach}</bdi></td>
                  <td className="px-2 py-2 text-end tabular-nums">{count(k.sessions)}</td>
                  {STOP_TYPES.map((t) => <td key={t} className={`px-2 py-2 text-end tabular-nums ${k.counts[t] ? 'font-semibold text-slate-900' : 'text-slate-400'}`}>{count(k.counts[t])}</td>)}
                  <td className="px-2 py-2 text-end font-bold tabular-nums">{count(k.total)}</td>
                  <td className="px-2 py-2 text-end tabular-nums">{one(k.sessions ? k.total / k.sessions : null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {stopsView.items.length ? (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-slate-900">{c.stopsList}</h3>
          {stopsView.items.length > STOPS_SHOWN ? <p className="text-xs text-slate-500">{c.stopsCapped(count(STOPS_SHOWN), count(stopsView.items.length))}</p> : null}
          <ul data-testid="dash-stops-list" className="divide-y divide-slate-100 text-xs sm:text-sm">
            {stopsView.items.slice(0, STOPS_SHOWN).map((it) => (
              <li key={it.key} data-testid="dash-stops-item" data-type={it.type} className="py-2">
                <p className="text-sm font-semibold text-slate-900">
                  {c.stopTypes[it.type] || it.type}{it.by && c.stopBy[it.by] ? ` · ${c.stopBy[it.by]}` : ''}{it.taskId ? ` · ${taskName(it.taskId)}` : ''}
                </p>
                <p className="text-xs text-slate-600">
                  {pktWhen(it.at) ? num(pktWhen(it.at)) : '–'} · {coaches.length > 1 ? <><bdi>{it.s.coachName || c.unknownCoach}</bdi> · </> : null}<bdi>{it.s.schoolName}</bdi> · {c.grade(num(it.s.grade))} · {it.s.mode ? c.modes[it.s.mode] : '–'}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );

  const originSection = (
    <section data-testid="dash-origin" aria-label={c.originTitle} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{c.originTitle}</h2>
        <p className="text-xs text-slate-500">{c.originHint}</p>
      </div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <li data-testid="dash-origin-drawn" className="rounded-xl bg-slate-50 p-2">
          <p className="text-xs text-slate-600">{c.drawn}</p>
          <p className="text-xl font-bold text-slate-900">{count(originView.totals.drawn)}</p>
        </li>
        <li data-testid="dash-origin-added" className="rounded-xl bg-slate-50 p-2">
          <p className="text-xs text-slate-600">{c.added}</p>
          <p className="text-xl font-bold text-slate-900">{count(originView.totals.added)} <span className="text-sm font-normal text-slate-600">· {pct(originView.share(originView.totals))}</span></p>
        </li>
        {originView.totals.unknown ? (
          <li data-testid="dash-origin-unknown" className="rounded-xl bg-slate-50 p-2">
            <p className="text-xs text-slate-600">{c.originUnknown}</p>
            <p className="text-xl font-bold text-slate-900">{count(originView.totals.unknown)}</p>
          </li>
        ) : null}
      </ul>
      {originView.rows.length ? (
        <div className="overflow-x-auto">
          <table data-testid="dash-origin-by-coach" className="w-full table-fixed text-xs sm:text-sm">
            <thead>
              <tr className="text-xs text-slate-600">
                <th className="px-2 py-1 text-start font-medium">{c.colCoach}</th>
                <th className="w-14 px-1 py-1 text-end font-medium">{c.colDrawn}</th>
                <th className="w-14 px-1 py-1 text-end font-medium">{c.colAdded}</th>
                <th className="w-16 px-1 py-1 text-end font-medium">{c.colAddedShare}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {originView.rows.map((k) => (
                <tr key={k.id || 'none'} data-testid="dash-origin-coach-row" data-coach={k.id} data-drawn={k.drawn} data-added={k.added}>
                  <td className="px-2 py-2 text-slate-900 [overflow-wrap:anywhere]"><bdi>{k.name || c.unknownCoach}</bdi></td>
                  <td className="w-14 px-1 py-2 text-end tabular-nums">{count(k.drawn)}</td>
                  <td className={`w-14 px-1 py-2 text-end tabular-nums ${k.added ? 'font-semibold text-slate-900' : 'text-slate-400'}`}>{count(k.added)}</td>
                  <td className="w-16 px-1 py-2 text-end tabular-nums">{pct(originView.share(k))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );

  let body;
  if (load === 'loading') body = <p className="text-slate-600">{c.loading}</p>;
  else if (load === 'off') body = <p data-testid="dash-off" className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-700">{c.off}</p>;
  else if (load === 'failed') body = <p data-testid="dash-load-failed" role="alert" className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-700">{c.loadFailed}</p>;
  else if (isLive && !cohort.length) {
    body = (
      <div className="space-y-3">
        <p data-testid="dash-live" role="note" className="rounded-2xl border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900">{c.live(count(0))}</p>
        {practiceToggle}
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
        {isLive ? practiceToggle : null}
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
          {filtersOn ? (<>
            <div className="flex flex-wrap gap-2">
              {chip('dash-mode-all', c.modeAll, !filter.mode, () => setFilter((f) => ({ ...f, mode: null })))}
              {chip('dash-mode-coach_led', c.modes.coach_led, filter.mode === 'coach_led', () => setFilter((f) => ({ ...f, mode: 'coach_led' })))}
              {chip('dash-mode-auto', c.modes.auto, filter.mode === 'auto', () => setFilter((f) => ({ ...f, mode: 'auto' })))}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col text-xs text-slate-600">{c.from}
                <input type="date" dir="ltr" data-testid="dash-date-from" value={filter.from ?? ''} max={filter.to ?? undefined}
                  onChange={(e) => { const v = e.target.value; setFilter((f) => ({ ...f, from: v || null })); }}
                  className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900" />
              </label>
              <label className="flex flex-col text-xs text-slate-600">{c.to}
                <input type="date" dir="ltr" data-testid="dash-date-to" value={filter.to ?? ''} min={filter.from ?? undefined}
                  onChange={(e) => { const v = e.target.value; setFilter((f) => ({ ...f, to: v || null })); }}
                  className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900" />
              </label>
              {filter.from || filter.to ? chip('dash-date-clear', c.clearDates, false, () => setFilter((f) => ({ ...f, from: null, to: null }))) : null}
              {coaches.length > 1 ? (
                <label className="flex min-w-0 flex-col text-xs text-slate-600">{c.coach}
                  <select data-testid="dash-coach" value={filter.coachId ?? ''} onChange={(e) => { const v = e.target.value; setFilter((f) => ({ ...f, coachId: v || null })); }}
                    className="min-h-[40px] max-w-full rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900">
                    <option value="">{c.allCoaches}</option>
                    {coaches.map((k) => <option key={k.id} value={k.id}>{k.name || c.unknownCoach}</option>)}
                  </select>
                </label>
              ) : null}
            </div>
            {narrowed ? <p data-testid="dash-showing" className="text-sm text-slate-700">{c.showing(count(rows.length), count(cohort.length))}</p> : null}
          </>) : null}
        </section>

        <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {tile('dash-total', c.students, hideAll ? c.fewer : count(h.n))}
          {tile('dash-rwc', `${c.rwc} · ${read === 'ur' ? c.urdu : c.english}`, hideAll ? '–' : pct(h.readingWithComprehension[read]), hideAll ? c.masked : c.rwcHint)}
          {tile('dash-orf', `${c.orf} · ${read === 'ur' ? c.urdu : c.english}`, hideAll ? '–' : one(h.orfMedian[read]), hideAll ? undefined : c.orfZero(pct(h.orfZero[read])))}
          {tile('dash-maths', c.maths, hideAll ? '–' : pct(h.mathsAllMet), hideAll ? undefined : c.mathsHint)}
          {tile('dash-minutes', c.minutes, hideAll ? '–' : one(h.minutesMedian))}
        </section>
        {filtersOn ? stopsSection : null}
        {filtersOn ? originSection : null}

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
