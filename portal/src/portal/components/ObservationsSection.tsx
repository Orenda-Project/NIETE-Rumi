import { useState } from 'react';
import Chart from 'react-apexcharts';
import { ApexOptions } from 'apexcharts';
import { Eye, Smartphone } from 'lucide-react';
import ScoreIndicator from './ScoreIndicator';
import { bandAxisLabel, bandTooltip } from '../lib/scoreBands';
import type { SchoolAnalytics } from '../types/portal';

/**
 * Observations — S·T·E of STEPS — on a principal's Analytics page, agreed with
 * the operator on 2026-09-29. The audience is not tech-savvy, so every title
 * and label is plain and no rating is ever a number.
 *
 *   Human Observation          — you or a coach watched the lesson in class
 *   Digital Coach Observation  — the teacher recorded her own lesson
 *
 * RATINGS (Progress, Strong and Weak Areas) come from Human Observations only:
 * STEPS feeds her ACR, and 83% of analysed sessions on prod are lessons she
 * recorded herself. The COUNTS and the monthly chart show both kinds.
 */

const HUMAN_COLOR = '#0f766e';
const DIGITAL_COLOR = '#9ca3af';

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function monthShort(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

/** Month of an ISO date in Pakistan time — matches how the server buckets them. */
function monthOf(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit' })
    .formatToParts(new Date(iso));
  return `${parts.find((p) => p.type === 'year')?.value}-${parts.find((p) => p.type === 'month')?.value}`;
}

const KIND_LABEL = { human: 'Human Observation', digital_coach: 'Digital Coach Observation' } as const;

const NO_HUMAN = 'No Human Observations yet. Once you or a coach watches a lesson in class, it will show here.';
const NO_HUMAN_MINE = 'No Human Observations yet. Once your principal or a coach watches your lesson in class, it will show here.';

/**
 * `audience` only changes the WORDS: a principal reads about her teachers, a
 * teacher reads about herself. The rules are the same page either way — except
 * that the server sends her own Digital Coach Observations WITH a rating
 * (operator, 2026-09-30), and a row shows a rating whenever it has one.
 */
const ObservationsSection = ({ analytics, showTeacher, audience = 'principal' }: {
  analytics: SchoolAnalytics; showTeacher: boolean; audience?: 'principal' | 'teacher';
}) => {
  const mine = audience === 'teacher';
  const human = analytics.humanObservations ?? 0;
  const digital = analytics.digitalCoachObservations ?? 0;
  const trend = analytics.scoreTrend ?? [];
  const areas = analytics.areas ?? [];
  const byMonth = analytics.byMonth ?? [];
  const observations = analytics.observations ?? [];

  const [month, setMonth] = useState<string | null>(byMonth.length ? byMonth[byMonth.length - 1].month : null);
  const monthRows = month ? observations.filter((o) => monthOf(o.date) === month) : [];

  const progressOptions: ApexOptions = {
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

  const monthsOptions: ApexOptions = {
    chart: {
      type: 'bar',
      stacked: true,
      toolbar: { show: false },
      events: {
        dataPointSelection: (_e, _c, cfg) => {
          const m = byMonth[cfg.dataPointIndex];
          if (m) setMonth(m.month);
        },
      },
    },
    colors: [HUMAN_COLOR, DIGITAL_COLOR],
    plotOptions: { bar: { borderRadius: 4, columnWidth: '45%' } },
    xaxis: { categories: byMonth.map((m) => monthShort(m.month)) },
    yaxis: { labels: { formatter: (v) => String(Math.round(Number(v))) }, forceNiceScale: true },
    legend: { position: 'top', horizontalAlign: 'left' },
    dataLabels: { enabled: false },
    grid: { borderColor: 'hsl(220, 13%, 91%)', strokeDashArray: 4 },
  };

  const block = 'bg-white rounded-lg p-6 shadow-sm border border-border';

  return (
    <section data-testid="observations" className="mb-8">
      <h2 className="text-2xl font-light mb-3">Observations</h2>
      <div className="grid gap-1 text-sm text-muted-foreground mb-5">
        <p data-testid="def-human">
          <strong className="text-foreground">Human Observation</strong> —{' '}
          {mine ? 'your principal or a coach watched your lesson in class.' : 'you or a coach watched the lesson in class.'}
        </p>
        <p data-testid="def-digital">
          <strong className="text-foreground">Digital Coach Observation</strong> —{' '}
          {mine ? 'you recorded your own lesson and NIETE gave feedback.' : 'the teacher recorded her own lesson and NIETE gave feedback.'}
        </p>
      </div>

      {/* The two counts, one per kind. */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div data-testid="count-human" className={block}>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <Eye className="w-5 h-5" style={{ color: HUMAN_COLOR }} /> Human Observations
          </div>
          <div className="text-3xl font-bold">{human}</div>
        </div>
        <div data-testid="count-digital" className={block}>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <Smartphone className="w-5 h-5 text-muted-foreground" /> Digital Coach Observations
          </div>
          <div className="text-3xl font-bold">{digital}</div>
        </div>
      </div>

      {/* Progress — Human Observations only. */}
      <div className={`${block} mb-6`}>
        <h3 className="text-xl font-medium mb-1">Progress</h3>
        <p data-testid="progress-help" className="text-muted-foreground text-sm mb-4">
          The rating from each Human Observation, oldest to newest.
        </p>
        {trend.length === 0 ? (
          <p className="text-sm text-muted-foreground">{mine ? NO_HUMAN_MINE : NO_HUMAN}</p>
        ) : (
          <Chart
            options={progressOptions}
            series={[{ name: 'Rating', data: trend.map((p) => p.percentage) }]}
            type="line"
            height={280}
          />
        )}
      </div>

      {/* Strong and Weak Areas — Human Observations only, the STEPS areas. */}
      <div className={`${block} mb-6`}>
        <h3 className="text-xl font-medium mb-1">Strong and Weak Areas</h3>
        <p className="text-muted-foreground text-sm mb-4">
          From Human Observations, strongest first.
        </p>
        {areas.length === 0 ? (
          <p className="text-sm text-muted-foreground">{mine ? NO_HUMAN_MINE : NO_HUMAN}</p>
        ) : (
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
        )}
      </div>

      {/* When Observations Happened — BOTH kinds, month by month. */}
      <div className={block}>
        <h3 className="text-xl font-medium mb-1">When Observations Happened</h3>
        <p className="text-muted-foreground text-sm mb-4">
          How many observations each month. Pick a month to see them.
        </p>
        {byMonth.length === 0 ? (
          <p className="text-sm text-muted-foreground">No observations yet.</p>
        ) : (
          <>
            <Chart
              options={monthsOptions}
              series={[
                { name: 'Human Observations', data: byMonth.map((m) => m.human) },
                { name: 'Digital Coach Observations', data: byMonth.map((m) => m.digitalCoach) },
              ]}
              type="bar"
              height={240}
            />
            {/* The same months as plain buttons — easier than tapping a bar. */}
            <div className="flex flex-wrap gap-2 mt-4 mb-4">
              {[...byMonth].reverse().map((m) => (
                <button
                  key={m.month}
                  type="button"
                  data-testid={`month-${m.month}`}
                  onClick={() => setMonth(m.month)}
                  aria-pressed={month === m.month}
                  className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    month === m.month ? 'border-accent bg-accent/10 text-foreground' : 'border-border bg-white hover:border-accent/50'
                  }`}
                >
                  {monthLabel(m.month)} · {m.human} Human · {m.digitalCoach} Digital Coach
                </button>
              ))}
            </div>
            {month && (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {monthRows.map((o, i) => (
                  <li key={`${o.date}-${i}`} data-testid={`obs-row-${i}`} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {new Date(o.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                        {' · '}
                        <span style={{ color: o.kind === 'human' ? HUMAN_COLOR : undefined }}>{KIND_LABEL[o.kind]}</span>
                      </p>
                      {showTeacher && o.teacherName && (
                        <p className="text-xs text-muted-foreground truncate">{o.teacherName}</p>
                      )}
                    </div>
                    {/* A rating whenever the server sent one: always for a Human
                        Observation; for a Digital Coach one only on her own page. */}
                    {o.percentage != null && <ScoreIndicator percentage={o.percentage} size="small" />}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
};

export default ObservationsSection;
