import type { ReactNode } from 'react';
import { Chip, MetricTile, type Feature } from '../newui';
import type { SchoolsAnalyticsOverview } from '../types/portal';
import type { AnalyticsWords } from './copy';
import { average, count } from './format';
import type { MetricKey } from './metrics';

/**
 * bd-s6qbts.3 — the overview tiles: PLAN v3 §2's fields added up for the selection (all regions, or one). Counts,
 * "x of N teachers" under LPs opened and DC observations, averages with how many were scored. Not tappable — there
 * is nothing behind a tile; the table below is the detail. bd-wfl8oz: no LPs generated, no coach visits.
 */
const ICON: Record<MetricKey, Feature> = {
  teachers: 'attendance',
  lpsOpened: 'lessonPlans',
  dcObservations: 'coaching',
  humanObservations: 'assessment',
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

  // `twoWide`: LPs opened carries two chips ("x of N teachers" and, for an early window, "logged since"), so it takes
  // two columns — which is also what lets seven tiles fill every row.
  const tiles: Array<{ k: MetricKey | 'schools'; value: string | null; chips?: ReactNode; twoWide?: boolean }> = [
    { k: 'schools', value: count(overview.schools, c) },
    { k: 'teachers', value: teachers },
    { k: 'lpsOpened', value: count(overview.lpsOpened, c), chips: <>{of(overview.teachersOpenedLp)}{note}</>, twoWide: true },
    { k: 'dcObservations', value: count(overview.dcObservations, c), chips: of(overview.teachersWithDc) },
    { k: 'humanObservations', value: count(overview.humanObservations, c) },
    { k: 'avgFico', value: average(overview.avgFico, c), chips: scored(overview.ficoN) },
    { k: 'avgHitl', value: average(overview.avgHitl, c), chips: scored(overview.hitlN) },
  ];

  return (
    // Seven tiles and no row left part-empty. Desktop, four across: Schools · Teachers · LPs opened (two wide), then
    // DC observations · Human observations · Avg FICO · Avg HITL. Phone, two across: LPs opened gets a row of its own.
    <div data-testid="overview" role="group" aria-label={c.overviewLabel} className="mb-8 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      {tiles.map(({ k, value, chips, twoWide }) => {
        const tile = (
          <MetricTile
            key={k}
            testId={`tile-${k}`}
            feature={k === 'schools' ? 'home' : ICON[k]}
            value={value}
            label={k === 'schools' ? c.schoolsTile : c.metrics[k]}
            chips={chips}
          />
        );
        // The kit's `wide` is a whole row with the icon beside the number; this is the normal tile, two cells wide.
        return twoWide ? <div key={k} className="col-span-2 flex">{tile}</div> : tile;
      })}
    </div>
  );
}
