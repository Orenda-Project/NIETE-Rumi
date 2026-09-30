import { useEffect, useRef, useState } from 'react';
import Chart from 'react-apexcharts';
import { ApexOptions } from 'apexcharts';
import { Eye, Smartphone } from 'lucide-react';
import ScoreIndicator from './ScoreIndicator';
import { bandAxisLabel, bandTooltip } from '../lib/scoreBands';
import type { SchoolAnalytics } from '../types/portal';

/**
 * Observations — S·T·E of STEPS — on both Analytics pages. The audience is
 * not tech-savvy, so every title and label is plain and no rating is ever a
 * number.
 *
 *   Human Observation          — a principal or coach watched the lesson in class
 *   Digital Coach Observation  — the teacher recorded her own lesson
 *
 * OBSERVATION FEEDBACK (the rating over time, and the strong and weak areas)
 * comes from Human Observations only: STEPS feeds her ACR, and 83% of
 * analysed sessions on prod are lessons she recorded herself. The COUNTS and
 * the day strip show both kinds (operator, 2026-09-29 / 2026-09-30).
 */

const HUMAN_COLOR = '#0f766e';
const DIGITAL_COLOR = '#6366f1';

/** The Pakistan-time day (YYYY-MM-DD) an instant falls on — how the server buckets them. */
function pkDay(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(iso));
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const isWeekend = (day: string) => [0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay());

function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/**
 * The strip's days: every school day (Mon–Fri) from the window's start — or
 * the first observation, when the window is open — to its end or today, plus
 * any weekend day on which something did happen, so nothing is ever hidden.
 */
function stripDays(observed: Set<string>, from: string | null, to: string | null): string[] {
  const sorted = [...observed].sort();
  const today = pkDay(new Date().toISOString());
  const start = from || sorted[0] || to || today;
  const end = to || (sorted.length && sorted[sorted.length - 1] > today ? sorted[sorted.length - 1] : today);
  const out: string[] = [];
  for (let d = start, guard = 0; d <= end && guard < 1500; d = addDays(d, 1), guard++) {
    if (!isWeekend(d) || observed.has(d)) out.push(d);
  }
  return out;
}

/** One kind of observation: its colour, its count, and one line saying what it is. */
const KindCard = ({ testid, color, icon, label, value, defTestid, definition }: {
  testid: string; color: string; icon: React.ReactNode; label: string; value: number;
  defTestid: string; definition: string;
}) => (
  <div
    data-testid={testid}
    className="relative overflow-hidden rounded-xl border p-5 sm:p-6 shadow-sm"
    style={{ borderColor: `${color}33`, background: `linear-gradient(135deg, ${color}14 0%, #ffffff 65%)` }}
  >
    <span aria-hidden className="absolute inset-y-0 left-0 w-1.5" style={{ background: color }} />
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white shadow-sm"
          style={{ background: color }}
        >
          {icon}
        </span>
        <span className="font-semibold leading-tight" style={{ color }}>{label}</span>
      </div>
      <span data-testid={`${testid}-value`} className="text-4xl font-bold tabular-nums text-foreground">{value}</span>
    </div>
    <p data-testid={defTestid} className="mt-4 border-t pt-3 text-sm text-muted-foreground" style={{ borderColor: `${color}26` }}>
      {definition}
    </p>
  </div>
);

const KIND_LABEL = { human: 'Human Observation', digital_coach: 'Digital Coach Observation' } as const;

const NO_HUMAN = 'No Human Observations yet. Once you or a coach watches a lesson in class, it will show here.';
const NO_HUMAN_MINE = 'No Human Observations yet. Once your principal or a coach watches your lesson in class, it will show here.';

/**
 * `audience` only changes the WORDS: a principal reads about her teachers, a
 * teacher reads about herself. The rules are the same page either way — except
 * that the server sends her own Digital Coach Observations WITH a rating
 * (operator, 2026-09-30), and a row shows a rating whenever it has one.
 *
 * `range` is the page's date window, so the day strip spans exactly it.
 */
const ObservationsSection = ({ analytics, showTeacher, audience = 'principal', range }: {
  analytics: SchoolAnalytics; showTeacher: boolean; audience?: 'principal' | 'teacher';
  range?: { from: string | null; to: string | null };
}) => {
  const mine = audience === 'teacher';
  const human = analytics.humanObservations ?? 0;
  const digital = analytics.digitalCoachObservations ?? 0;
  const trend = analytics.scoreTrend ?? [];
  const areas = analytics.areas ?? [];
  const observations = analytics.observations ?? [];
  const noHuman = mine ? NO_HUMAN_MINE : NO_HUMAN;

  // Observations per Pakistan-time day, by kind.
  const perDay = new Map<string, { human: number; digital: number }>();
  for (const o of observations) {
    const d = pkDay(o.date);
    const c = perDay.get(d) || { human: 0, digital: 0 };
    if (o.kind === 'human') c.human += 1; else c.digital += 1;
    perDay.set(d, c);
  }
  const days = stripDays(new Set(perDay.keys()), range?.from ?? null, range?.to ?? null);
  const latest = [...perDay.keys()].sort().pop() ?? null;
  const [day, setDay] = useState<string | null>(latest);
  useEffect(() => { setDay(latest); }, [latest]);
  const dayRows = day ? observations.filter((o) => pkDay(o.date) === day) : [];

  // Open the strip at its newest end — that is where she will look first.
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (stripRef.current) stripRef.current.scrollLeft = stripRef.current.scrollWidth;
  }, [days.length]);

  const ratingOptions: ApexOptions = {
    chart: { type: 'line', toolbar: { show: false }, zoom: { enabled: false } },
    stroke: { curve: 'smooth', width: 3 },
    colors: [HUMAN_COLOR],
    grid: { borderColor: 'hsl(220, 13%, 91%)', strokeDashArray: 4 },
    xaxis: {
      categories: trend.map((p) =>
        new Date(p.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })),
      labels: { style: { colors: 'hsl(220, 9%, 46%)', fontSize: '12px' } },
      // Both axes say what they are (feedback item 2) — in plain words.
      title: { text: 'Date observed', style: { color: 'hsl(220, 9%, 46%)', fontSize: '12px', fontWeight: 500 } },
    },
    yaxis: {
      min: 0, max: 100, tickAmount: 5,
      labels: { formatter: (v) => bandAxisLabel(Number(v)) },
      title: { text: 'Rating', style: { color: 'hsl(220, 9%, 46%)', fontSize: '12px', fontWeight: 500 } },
    },
    tooltip: { y: { formatter: (v) => bandTooltip(Number(v)) } },
    dataLabels: { enabled: false },
    markers: { size: 5 },
  };

  const block = 'bg-white rounded-lg p-6 shadow-sm border border-border';

  return (
    <section data-testid="observations" className="mb-8">
      <h2 className="text-2xl font-light mb-4">Observations</h2>

      {/* The two counts, one per kind — each card says what its kind IS,
          beside the number (operator, 2026-09-30). The card's colour is the
          colour that kind carries in the strip below. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <KindCard
          testid="count-human"
          color={HUMAN_COLOR}
          icon={<Eye className="w-5 h-5" />}
          label="Human Observations"
          value={human}
          defTestid="def-human"
          definition={mine ? 'Your principal or a coach watched your lesson in class.' : 'You or a coach watched the lesson in class.'}
        />
        <KindCard
          testid="count-digital"
          color={DIGITAL_COLOR}
          icon={<Smartphone className="w-5 h-5" />}
          label="Digital Coach Observations"
          value={digital}
          defTestid="def-digital"
          definition={mine ? 'You recorded your own lesson and NIETE gave feedback.' : 'The teacher recorded her own lesson and NIETE gave feedback.'}
        />
      </div>

      {/* Observation Feedback — ONE section: how the rating moved, and which
          areas are strongest and weakest. Human Observations only. */}
      <div data-testid="observation-feedback" className={`${block} mb-6`}>
        <h3 className="text-xl font-medium mb-1">Observation Feedback</h3>
        <p data-testid="progress-help" className="text-muted-foreground text-sm mb-5">
          From Human Observations: the rating each time, oldest to newest, and the areas from strongest to weakest.
        </p>
        {trend.length === 0 && areas.length === 0 ? (
          <p className="text-sm text-muted-foreground">{noHuman}</p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <h4 className="text-sm font-semibold text-muted-foreground mb-2">Rating over time</h4>
              {trend.length === 0 ? (
                <p className="text-sm text-muted-foreground">{noHuman}</p>
              ) : (
                <Chart
                  options={ratingOptions}
                  series={[{ name: 'Rating', data: trend.map((p) => p.percentage) }]}
                  type="line"
                  height={260}
                />
              )}
            </div>
            <div className="lg:col-span-2">
              <h4 className="text-sm font-semibold text-muted-foreground mb-2">Strongest to weakest</h4>
              <ol className="space-y-2">
                {areas.map((a, i) => {
                  const weakest = areas.length > 1 && i === areas.length - 1;
                  return (
                    <li
                      key={a.key}
                      data-testid={`area-${a.key}`}
                      className={`flex items-center justify-between gap-3 rounded-lg px-4 py-3 ${weakest ? 'bg-warning/10' : 'bg-secondary'}`}
                    >
                      <span className="font-medium">{i + 1}. {a.name}</span>
                      <span className="flex items-center gap-2">
                        <ScoreIndicator percentage={a.pct} size="small" />
                        {weakest && <span className="text-xs font-semibold text-warning">← work on this</span>}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        )}
      </div>

      {/* When Observations Happened — BOTH kinds, day by day, in the same
          strip the Attendance page uses (operator, 2026-09-30). */}
      <div className={block}>
        <h3 className="text-xl font-medium mb-1">When Observations Happened</h3>
        <p className="text-muted-foreground text-sm mb-4">
          Each box is a school day, with how many observations happened. Pick a day to see them.
        </p>
        {observations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {range?.from || range?.to ? 'No observations in these dates.' : 'No observations yet.'}
          </p>
        ) : (
          <>
            <div ref={stripRef} data-testid="obs-strip" className="overflow-x-auto pb-4 -mb-1">
              <div className="flex gap-2 min-w-max">
                {days.map((d) => {
                  const c = perDay.get(d);
                  const n = c ? c.human + c.digital : 0;
                  const bg = !c ? undefined
                    : c.human && c.digital ? `linear-gradient(135deg, ${HUMAN_COLOR} 50%, ${DIGITAL_COLOR} 50%)`
                      : c.human ? HUMAN_COLOR : DIGITAL_COLOR;
                  const tip = !c ? `${dayLabel(d)} — no observation`
                    : `${dayLabel(d)} — ${c.human} Human, ${c.digital} Digital Coach`;
                  return (
                    <div key={d} className="flex flex-col items-center gap-1">
                      <span className="w-11 text-center text-[9.5px] leading-tight text-muted-foreground">{dayLabel(d)}</span>
                      <button
                        type="button"
                        data-testid={`obs-day-${d}`}
                        title={tip}
                        disabled={!c}
                        onClick={() => setDay(d)}
                        aria-pressed={day === d}
                        className={`w-11 h-7 rounded box-border flex items-center justify-center text-[10.5px] font-bold shrink-0 ${
                          day === d ? 'ring-2 ring-offset-1 ring-foreground/60' : ''
                        }`}
                        style={c ? { background: bg, color: '#ffffff' }
                          : { background: '#f9fafb', border: '1.5px dashed #d1d5db', color: '#9ca3af' }}
                      >
                        {n || '–'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap gap-5 text-xs text-muted-foreground mt-2 mb-4">
              <span className="flex items-center gap-2"><span className="inline-block w-4 h-3 rounded-sm" style={{ background: HUMAN_COLOR }} />Human Observation</span>
              <span className="flex items-center gap-2"><span className="inline-block w-4 h-3 rounded-sm" style={{ background: DIGITAL_COLOR }} />Digital Coach Observation</span>
              <span className="flex items-center gap-2"><span className="inline-block w-4 h-3 rounded-sm" style={{ background: `linear-gradient(135deg, ${HUMAN_COLOR} 50%, ${DIGITAL_COLOR} 50%)` }} />Both</span>
              <span className="flex items-center gap-2"><span className="inline-block w-4 h-3 rounded-sm" style={{ background: '#f9fafb', border: '1.5px dashed #d1d5db' }} />None</span>
            </div>

            {day && (
              <>
                <p className="text-sm font-medium mb-2">
                  {new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}
                </p>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {dayRows.map((o, i) => (
                    <li key={`${o.date}-${i}`} data-testid={`obs-row-${i}`} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          <span style={{ color: o.kind === 'human' ? HUMAN_COLOR : DIGITAL_COLOR }}>{KIND_LABEL[o.kind]}</span>
                        </p>
                        {showTeacher && o.teacherName && (
                          <p className="text-xs text-muted-foreground truncate">{o.teacherName}</p>
                        )}
                      </div>
                      {/* A row shows its rating whenever it has one. */}
                      {o.percentage != null && <ScoreIndicator percentage={o.percentage} size="small" />}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
};

export default ObservationsSection;
