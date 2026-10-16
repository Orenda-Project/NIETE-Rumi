import { useEffect, useState, type ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { analytics } from '../../services/api';
import type {
  LpBand, LpEngagementResponse, LpEngagementRow, LpEngagementSchool, LpStatus,
} from '../../types/portal';
import { BandToggle, useBandParam } from '../BandToggle';
import type { AnalyticsWords } from '../copy';
import { count, NO_VALUE } from '../format';
import { GroupedBarChart, RingGauge } from '../LpCharts';
import { Section } from '../Section';
import { Breakdown, SectorCard, SectorGrid } from '../SectorCards';
import { regionParam, useSchoolsView } from '../view';
import { BAND_COLOR, gradeColor, HER_GREEN, KPI_LOOK, subjectColor, TABLE_COLOR, type KpiLook } from './lpLook';
import { lpNoteChip, schoolsIn, toggleRegion, type TabProps } from './shared';

/**
 * bd-97x22y.3 — LP Engagement, the ICT dashboard's tab 1 to 1 (PLAN v7 "LP Engagement"; operator: "fully 1 to 1").
 * Hers: frontend/src/pages/LPEngagement.jsx. Her sections, in her order:
 *
 *   the Primary / Mid-High toggle
 *   ENGAGEMENT OVERVIEW   Overall LP Engagement %, Total Teachers Tracked, Active Sectors (her KPI cards)
 *   TEACHER STATUS        On-Schedule (≥60%), Moderate (40–59%), Off-Schedule (<40%) teachers
 *   SECTORS — CLICK TO VIEW SCHOOL BREAKDOWN   a ring card per sector → its schools (LP %, status)
 *   LP Engagement by Subject · LP Engagement by Grade   her band shares and LP %, with her Overall row
 *   Sector-wise Performance in Subjects & Grades       her grouped bars, View By Subjects / Grades
 *
 * Its numbers are its own read (GET /analytics/lp-engagement, the page's window and region plus the band), so the
 * tab's cost never slows the others; her formula is the server's (services/lp-engagement.service.js) and the page draws
 * the integers it sends. Her sector filter is the page's region; choosing a sector card is choosing that region (v6).
 * Her colours (lpLook.ts) and her %, here only — as the Trainings tab does.
 */
type Status = 'loading' | 'ready' | 'error' | 'forbidden';
const statusOf = (err: unknown): Status => ((err as { response?: { status?: number } })?.response?.status === 403 ? 'forbidden' : 'error');

const BANDS: readonly LpStatus[] = ['on', 'moderate', 'off'];
const COUNT_OF: Record<LpStatus, 'onSchedule' | 'moderate' | 'offSchedule'> = { on: 'onSchedule', moderate: 'moderate', off: 'offSchedule' };
const SHARE_OF: Record<LpStatus, 'onPct' | 'moderatePct' | 'offPct'> = { on: 'onPct', moderate: 'moderatePct', off: 'offPct' };

const pctOr = (c: AnalyticsWords, v: number | null | undefined) => (typeof v === 'number' ? c.percent(String(v)) : NO_VALUE);

/** Her card frame (her tables and chart): white, a light grey line, a soft shadow. */
const CARD_STYLE = { border: '1px solid #E5E7EB', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' };

function useLpEngagement(region: string | null, band: LpBand) {
  const view = useSchoolsView();
  const key = `${view.from ?? ''}|${view.to ?? ''}|${regionParam(region)}|${band}`;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ status: Status; data: LpEngagementResponse | null }>({ status: 'loading', data: null });
  useEffect(() => {
    let alive = true;
    // A new window, region or band keeps the last answer on screen, dimmed, until the next one arrives.
    setState((s) => ({ status: 'loading', data: s.data }));
    analytics
      .getLpEngagement({ from: view.from, to: view.to, region: regionParam(region), band })
      .then((d) => { if (alive) setState({ status: 'ready', data: d }); })
      .catch((err) => { if (alive) setState({ status: statusOf(err), data: null }); });
    return () => { alive = false; };
    // `key` carries from, to, region and band.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}

export function LpTab(p: TabProps) {
  const { c, region, lpOpensNote } = p;
  const w = c.lpEngagement;
  const { band, setBand } = useBandParam();
  const lp = useLpEngagement(region, band);

  return (
    <div className="flex flex-col gap-6">
      <BandToggle label={w.bandLabel} labels={w.bands} band={band} onBand={setBand} />

      {lp.status === 'error' || lp.status === 'forbidden' ? (
        <div data-testid="lp-error" role="alert" className="rounded-2xl border border-border bg-white p-6 shadow-sm">
          <p className="mb-4 text-muted-foreground">{lp.status === 'forbidden' ? c.states.forbidden : w.error}</p>
          {lp.status === 'forbidden' ? null : (
            <button
              type="button"
              data-testid="lp-retry"
              onClick={lp.retry}
              className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {c.states.retry}
            </button>
          )}
        </div>
      ) : null}

      {!lp.data && lp.status === 'loading' ? (
        <div data-testid="lp-loading" aria-busy="true" aria-label={w.loading} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-[132px] rounded-xl" />)}
          </div>
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      ) : null}

      {lp.data && (lp.status === 'ready' || lp.status === 'loading') ? (
        <LpBody p={p} data={lp.data} busy={lp.status === 'loading'} note={lpOpensNote} />
      ) : null}
    </div>
  );
}

function LpBody({ p, data, busy, note }: { p: TabProps; data: LpEngagementResponse; busy: boolean; note: string | null }) {
  const { c, region } = p;
  const w = c.lpEngagement;
  const o = data.overview;
  const shown = data.band;
  return (
    <div data-testid="lp-tab" aria-busy={busy} className="flex flex-col gap-6 transition-opacity" style={{ opacity: busy ? 0.6 : 1 }}>
      <Section id="lp-overview" eyebrow={w.sections.overview}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <KpiCard k="lpOverall" look={KPI_LOOK.overall} label={w.tiles.overall} value={o.lpPct === null ? null : c.percent(String(o.lpPct))} hint={w.hints.overall[shown]} extra={lpNoteChip(note)} />
          <KpiCard k="lpTracked" look={KPI_LOOK.tracked} label={w.tiles.tracked} value={count(o.teachers, c)} hint={w.hints.tracked} />
          <KpiCard k="lpActiveSectors" look={KPI_LOOK.activeSectors} label={w.tiles.activeSectors} value={count(o.activeSectors, c)} hint={w.hints.activeSectors} />
        </div>
      </Section>

      <Section id="lp-status" eyebrow={w.sections.status}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {BANDS.map((b) => (
            <KpiCard key={b} k={`lp-${b}`} look={KPI_LOOK[b]} label={w.tiles[COUNT_OF[b]]} value={count(o[COUNT_OF[b]], c)} hint={w.hints[COUNT_OF[b]]} />
          ))}
        </div>
      </Section>

      <Section id="sectors" eyebrow={w.sections.sectors}>
        <SectorGrid wide>
          {data.regions.map((r) => (
            <SectorCard key={r.region} region={r.region} selected={region === r.region} onSelect={() => toggleRegion(p, r.region)} action={c.sectorCards.view} hide={c.sectorCards.hide}>
              <RingGauge pct={r.lpPct} caption={w.ring} color={HER_GREEN} c={c} />
              <span className="mt-3 flex flex-col gap-1.5">
                {BANDS.map((b) => (
                  <span key={b} data-testid={`band-line-${b}`} className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="text-gray-500">{w.status[b]}</span>
                    <span className="font-semibold tabular-nums" style={{ color: BAND_COLOR[b] }}>
                      {count(r[COUNT_OF[b]], c)}
                      {/* Her share in brackets, only beside a count that is not 0. */}
                      {r[COUNT_OF[b]] > 0 && r[SHARE_OF[b]] !== null ? <span className="ms-1 font-normal text-gray-400">({pctOr(c, r[SHARE_OF[b]])})</span> : null}
                    </span>
                  </span>
                ))}
              </span>
              <span className="mt-2.5 flex items-baseline justify-between gap-2 border-t border-gray-100 pt-2.5 text-xs">
                <span className="text-gray-400">{w.totalTeachers}</span>
                <b data-testid="sector-teachers" className="tabular-nums text-gray-800">{count(r.teachers, c)}</b>
              </span>
            </SectorCard>
          ))}
        </SectorGrid>
        {region ? (
          <Breakdown c={c} region={region} onBack={() => p.onRegion(null)}>
            <LpSchoolsTable c={c} schools={schoolsIn(data.schools, region)} />
          </Breakdown>
        ) : null}
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {data.bySubject.rows.length ? (
          <LpTable
            c={c} testId="lp-subjects-table" title={w.cards.bySubject} first={w.columns.subject} overall={data.bySubject.overall}
            rows={data.bySubject.rows.map((r) => ({
              key: r.subject, row: r,
              head: (
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: subjectColor(r.subject) }} />
                  {r.name}
                </span>
              ),
            }))}
          />
        ) : null}
        <LpTable
          c={c} testId="lp-grades-table" title={w.cards.byGrade(w.grades[shown])} first={w.columns.grade} overall={data.byGrade.overall}
          rows={data.byGrade.rows.map((r) => ({ key: String(r.grade), row: r, head: <span className="whitespace-nowrap">{w.grade(String(r.grade))}</span> }))}
        />
      </div>

      {data.bySubject.rows.length ? <LpSectorChart c={c} data={data} region={region} /> : null}
    </div>
  );
}

/** Her KPI card (LPKPICard): a 2px border in its colour, the name in small capitals, the icon in a tint, the number. */
function KpiCard({ k, look, label, value, hint, extra }: {
  k: string;
  look: KpiLook;
  label: string;
  value: string | null;
  hint: string;
  extra?: ReactNode;
}) {
  const { Icon } = look;
  return (
    <div data-testid={`tile-${k}`} className="flex min-w-0 flex-col gap-3 rounded-xl bg-white p-5" style={{ border: `2px solid ${look.color}`, boxShadow: `0 1px 4px ${look.color}18` }}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">{label}</p>
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: look.light }}>
          <Icon className="h-[17px] w-[17px]" style={{ color: look.color }} />
        </span>
      </div>
      <p data-testid="kpi-value" className="text-3xl font-bold leading-none tabular-nums text-gray-900">{value ?? NO_VALUE}</p>
      <p className="text-xs leading-relaxed text-gray-700">{hint}</p>
      {extra ? <span className="-mt-1 flex flex-wrap gap-1.5">{extra}</span> : null}
    </div>
  );
}

/** Her subject / grade table (LPBySubjectTable / LPByGradeTable): band shares as %, the LP %, her Overall row. */
function LpTable({ c, testId, title, first, rows, overall }: {
  c: AnalyticsWords;
  testId: string;
  title: string;
  first: string;
  rows: Array<{ key: string; head: ReactNode; row: LpEngagementRow }>;
  overall: LpEngagementRow | null;
}) {
  const w = c.lpEngagement;
  const cells = (r: LpEngagementRow, strong = false) => (
    <>
      {BANDS.map((b) => (
        <td key={b} data-testid={`cell-${b}`} className={`px-1.5 py-2.5 text-end tabular-nums sm:px-3 ${strong ? 'font-bold' : 'font-semibold'}`} style={{ color: TABLE_COLOR[b] }}>
          {pctOr(c, r[SHARE_OF[b]])}
        </td>
      ))}
      <td data-testid="cell-lp" className="py-2.5 pe-3 ps-1.5 text-end font-bold tabular-nums sm:px-4" style={{ color: HER_GREEN }}>{pctOr(c, r.lpPct)}</td>
    </>
  );
  return (
    <section data-testid={`${testId}-card`} aria-labelledby={`${testId}-title`} className="min-w-0 overflow-hidden rounded-xl bg-white" style={CARD_STYLE}>
      <h3 id={`${testId}-title`} data-testid="card-title" className="px-4 py-3 text-sm font-bold text-gray-800" style={{ borderBottom: '1px solid #f3f4f6' }}>{title}</h3>
      {/* A phone too narrow for her five columns scrolls the table inside its card; the page itself never scrolls. */}
      <div className="overflow-x-auto">
      <table data-testid={testId} className="w-full text-[13px] sm:text-sm">
        <thead>
          <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #E5E7EB' }}>
            <th scope="col" className="py-2.5 pe-1.5 ps-3 text-start text-xs font-semibold text-gray-500 sm:px-4">{first}</th>
            {BANDS.map((b) => (
              <th key={b} scope="col" className="px-1.5 py-2.5 text-end text-xs font-semibold leading-tight sm:px-3" style={{ color: TABLE_COLOR[b] }}>
                {w.columns.bands[b][0]}<br />{w.columns.bands[b][1]}
              </th>
            ))}
            <th scope="col" className="py-2.5 pe-3 ps-1.5 text-end text-xs font-semibold sm:px-4" style={{ color: HER_GREEN }}>{w.columns.lpShort}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ key, head, row }) => (
            <tr key={key} data-testid={`${testId}-row-${key}`} className="hover:bg-gray-50" style={{ borderBottom: '1px solid #f3f4f6' }}>
              <th scope="row" className="py-2.5 pe-1.5 ps-3 text-start font-medium text-gray-700 sm:px-4">{head}</th>
              {cells(row)}
            </tr>
          ))}
          {overall ? (
            <tr data-testid={`${testId}-overall`} style={{ backgroundColor: '#f9fafb', borderTop: '2px solid #E5E7EB' }}>
              <th scope="row" className="py-2.5 pe-1.5 ps-3 text-start font-bold text-gray-800 sm:px-4">{w.overall}</th>
              {cells(overall, true)}
            </tr>
          ) : null}
        </tbody>
      </table>
      </div>
    </section>
  );
}

/** Her sector breakdown (SectorBreakdownTable): each school with its LP % and her status pill. */
function LpSchoolsTable({ c, schools }: { c: AnalyticsWords; schools: LpEngagementSchool[] }) {
  const w = c.lpEngagement;
  if (!schools.length) return <p data-testid="lp-schools-empty" className="py-3 text-sm text-gray-500">{w.noSchools}</p>;
  return (
    <div className="overflow-hidden rounded-xl bg-white" style={CARD_STYLE}>
      <table data-testid="lp-schools-table" className="w-full text-sm">
        <thead>
          <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #E5E7EB' }}>
            <th scope="col" className="px-3 py-3 text-start font-semibold text-gray-600 sm:px-4">{w.columns.school}</th>
            <th scope="col" className="px-3 py-3 text-end font-semibold text-gray-600 sm:px-4">{w.columns.lp}</th>
            <th scope="col" className="px-3 py-3 text-end font-semibold sm:px-4" style={{ color: HER_GREEN }}>{w.columns.status}</th>
          </tr>
        </thead>
        <tbody>
          {schools.map((s, i) => (
            <tr key={s.schoolId} data-testid={`lp-school-row-${s.schoolId}`} className="hover:bg-gray-50" style={{ borderBottom: i < schools.length - 1 ? '1px solid #f3f4f6' : 'none' }}>
              <th scope="row" className="px-3 py-3 text-start font-medium sm:px-4">
                <span data-testid="school-name" className="block" style={{ color: HER_GREEN }}>{s.name}</span>
                {s.emis ? <span className="block text-xs font-normal text-gray-400">{c.schools.emis(s.emis)}</span> : null}
              </th>
              <td data-testid="cell-lp" className="px-3 py-3 text-end text-lg font-bold tabular-nums sm:px-4" style={{ color: HER_GREEN }}>{pctOr(c, s.lpPct)}</td>
              <td data-testid="cell-status" className="px-3 py-3 text-end sm:px-4">
                {s.status ? (
                  <span className="inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold" style={{ backgroundColor: `${BAND_COLOR[s.status]}18`, color: BAND_COLOR[s.status] }}>
                    {w.status[s.status]}
                  </span>
                ) : NO_VALUE}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Her SectorSubjectChart: the six sectors, a bar per subject (or grade), View By Subjects / Grades. */
function LpSectorChart({ c, data, region }: { c: AnalyticsWords; data: LpEngagementResponse; region: string | null }) {
  const w = c.lpEngagement;
  const [viewBy, setViewBy] = useState<'subjects' | 'grades'>('subjects');
  const bySubjects = viewBy === 'subjects';
  const series = bySubjects
    ? data.bySubject.rows.map((r) => ({ key: r.subject, label: r.name, color: subjectColor(r.subject) }))
    : data.byGrade.rows.map((r, i) => ({ key: String(r.grade), label: w.grade(String(r.grade)), color: gradeColor(i) }));
  const matrix = new Map((bySubjects ? data.sectorSubjects : data.sectorGrades).map((s) => [s.region, s.values]));
  return (
    <section data-testid="lp-chart-card" aria-labelledby="lp-chart-title" className="rounded-xl bg-white p-5" style={CARD_STYLE}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="lp-chart-title" data-testid="card-title" className="text-sm font-bold text-gray-800">{w.cards.chart}</h3>
          <p className="mt-0.5 text-xs text-gray-400">{w.cards.chartHint}</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-400">
          {w.viewBy}
          <select
            data-testid="lp-view-by"
            value={viewBy}
            onChange={(e) => setViewBy(e.target.value === 'grades' ? 'grades' : 'subjects')}
            className="h-11 rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            style={{ backgroundColor: '#f9fafb' }}
          >
            <option value="subjects">{w.viewByOptions.subjects}</option>
            <option value="grades">{w.viewByOptions.grades}</option>
          </select>
        </label>
      </div>
      <GroupedBarChart
        testId={`chart-lp-${viewBy}`}
        label={w.cards.chart}
        groups={data.regions.map((r) => ({ key: r.region, label: r.region }))}
        series={series}
        value={(g, s) => matrix.get(g)?.[s] ?? null}
        selected={region}
        c={c}
      />
    </section>
  );
}
