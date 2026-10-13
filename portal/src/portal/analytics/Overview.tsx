import type { ReactNode } from 'react';
import { Chip, MetricTile, type Feature } from '../newui';
import type { SchoolsAnalyticsOverview } from '../types/portal';
import type { AnalyticsWords } from './copy';
import { average, count } from './format';
import type { MetricKey } from './metrics';

/**
 * bd-s6qbts.3 — the overview tiles: PLAN v3 §2's fields added up for the selection (all regions, or one). Counts,
 * "x of N teachers" under LPs opened and DC observations, averages with how many were scored. Not tappable — there
 * is nothing behind a tile; the table below is the detail.
 */
const ICON: Record<MetricKey, Feature> = {
  teachers: 'attendance',
  lpsOpened: 'lessonPlans',
  lpsGenerated: 'lessonPlans',
  dcObservations: 'coaching',
  humanObservations: 'assessment',
  coachVisits: 'training',
  avgFico: 'coaching',
  avgHitl: 'assessment',
};

export function Overview({ c, overview, lpOpensNote }: {
  c: AnalyticsWords;
  overview: SchoolsAnalyticsOverview;
  /** "logged since 4 Oct", when the window starts before LP opens were recorded. */
  lpOpensNote: string | null;
}) {
  const teachers = count(overview.teachers, c);
  const of = (x: number) => <Chip>{c.xOfN(count(x, c), teachers)}</Chip>;
  const scored = (n: number) => (n > 0 ? <Chip>{c.scored(count(n, c))}</Chip> : null);
  const note = lpOpensNote ? <span data-testid="lp-opens-note"><Chip>{lpOpensNote}</Chip></span> : null;

  const tiles: Array<{ k: MetricKey | 'schools'; value: string | null; chips?: ReactNode }> = [
    { k: 'schools', value: count(overview.schools, c) },
    { k: 'teachers', value: teachers },
    { k: 'lpsOpened', value: count(overview.lpsOpened, c), chips: <>{of(overview.teachersOpenedLp)}{note}</> },
    { k: 'lpsGenerated', value: count(overview.lpsGenerated, c) },
    { k: 'dcObservations', value: count(overview.dcObservations, c), chips: of(overview.teachersWithDc) },
    { k: 'humanObservations', value: count(overview.humanObservations, c) },
    { k: 'coachVisits', value: count(overview.coachVisits, c) },
    { k: 'avgFico', value: average(overview.avgFico, c), chips: scored(overview.ficoN) },
    { k: 'avgHitl', value: average(overview.avgHitl, c), chips: scored(overview.hitlN) },
  ];

  return (
    // Nine tiles: three across on a desktop (the design's 3 × 3), two on a phone — the kit's MetricGrid is four across.
    <div data-testid="overview" role="group" aria-label={c.overviewLabel} className="mb-8 grid grid-cols-2 gap-2.5 lg:grid-cols-3">
      {tiles.map(({ k, value, chips }) => (
        <MetricTile
          key={k}
          testId={`tile-${k}`}
          feature={k === 'schools' ? 'home' : ICON[k]}
          value={value}
          label={k === 'schools' ? c.schoolsTile : c.metrics[k]}
          chips={chips}
        />
      ))}
    </div>
  );
}
