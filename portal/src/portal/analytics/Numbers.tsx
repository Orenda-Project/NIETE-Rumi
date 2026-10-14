import { cn } from '@/lib/utils';
import type { SchoolsAnalyticsCounts } from '../types/portal';
import type { AnalyticsWords } from './copy';
import { count, isLowN, NO_VALUE, score } from './format';
import type { ColumnKey, MetricKey, ScoreKey } from './metrics';

/**
 * bd-s6qbts.3 — one number as the school table and the phone cards show it:
 *   a count       "52", and for LPs opened / training / DC observations "14 of 30" under it (x of the school's N
 *                 teachers);
 *   a score       "68.4% (17)"; fewer than 3 scored → grey (data-low-n); nothing scored → "—" alone.
 *
 * bd-97x22y.2 — scores as %, usage as counts (operator, 2026-10-14). A score value is marked `data-score` (fico /
 * hitl): the page test checks that every % on the page sits inside one.
 */
/** Which teachers-count goes with a count, if any ("x of N teachers"). */
const OF_TEACHERS: Partial<Record<MetricKey, keyof SchoolsAnalyticsCounts>> = {
  lpsOpened: 'teachersOpenedLp',
  trainingModules: 'teachersTrained',
  dcObservations: 'teachersWithDc',
};

export const SCORE_N: Record<ScoreKey, 'ficoN' | 'hitlN'> = { avgFico: 'ficoN', avgHitl: 'hitlN' };
export const SCORE_ATTR: Record<ScoreKey, 'fico' | 'hitl'> = { avgFico: 'fico', avgHitl: 'hitl' };

type Row = Partial<SchoolsAnalyticsCounts> & { coachVisits?: number };

export function MetricValue({ k, row, c, testId, long = false, className }: {
  k: ColumnKey;
  row: Row;
  c: AnalyticsWords;
  testId?: string;
  /** "14 of 30 teachers" rather than "14 of 30". */
  long?: boolean;
  className?: string;
}) {
  if (k === 'avgFico' || k === 'avgHitl') {
    const shown = score(row[k], c);
    const n = row[SCORE_N[k]] ?? 0;
    if (shown === null) {
      return <span data-testid={testId} className={cn('text-muted-foreground', className)}>{NO_VALUE}</span>;
    }
    const low = isLowN(n);
    return (
      <span
        data-testid={testId}
        data-score={SCORE_ATTR[k]}
        data-low-n={low ? 'true' : undefined}
        className={cn('tabular-nums', low ? 'text-muted-foreground' : 'font-semibold text-foreground', className)}
      >
        {shown}{' '}<span className="text-xs font-normal text-muted-foreground">({count(n, c)})</span>
      </span>
    );
  }
  const ofKey = k === 'coachVisits' ? undefined : OF_TEACHERS[k];
  return (
    <span data-testid={testId} className={cn('inline-flex flex-col tabular-nums', className)}>
      <span className="font-semibold text-foreground">{count(row[k] as number, c)}</span>
      {/* A space a screen reader hears between "52" and "14 of 30"; the column layout ignores it. */}
      {ofKey ? ' ' : null}
      {ofKey ? (
        <span className="text-xs font-normal text-muted-foreground">
          {(long ? c.xOfN : c.xOfNShort)(count(row[ofKey] as number, c), count(row.teachers, c))}
        </span>
      ) : null}
    </span>
  );
}
