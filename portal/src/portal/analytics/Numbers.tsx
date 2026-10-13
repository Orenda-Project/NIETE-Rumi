import { cn } from '@/lib/utils';
import type { SchoolsAnalyticsCounts } from '../types/portal';
import type { AnalyticsWords } from './copy';
import { average, count, isLowN, NO_VALUE } from './format';
import type { MetricKey } from './metrics';

/**
 * bd-s6qbts.3 — one number as the school table, the phone cards and the region cards all show it:
 *   a count       "52", and for LPs opened / DC observations "14 of 30" under it (x of the school's N teachers);
 *   an average    "68.4 (17)"; fewer than 3 scored → grey (data-low-n); nothing scored → "—" alone.
 */
/** Which teachers-count goes with a count, if any ("x of N teachers"). */
const OF_TEACHERS: Partial<Record<MetricKey, keyof SchoolsAnalyticsCounts>> = {
  lpsOpened: 'teachersOpenedLp',
  dcObservations: 'teachersWithDc',
};

const SCORE: Partial<Record<MetricKey, ['avgFico' | 'avgHitl', 'ficoN' | 'hitlN']>> = {
  avgFico: ['avgFico', 'ficoN'],
  avgHitl: ['avgHitl', 'hitlN'],
};

export function MetricValue({ k, row, c, testId, long = false, className }: {
  k: MetricKey;
  row: SchoolsAnalyticsCounts;
  c: AnalyticsWords;
  testId?: string;
  /** "14 of 30 teachers" rather than "14 of 30". */
  long?: boolean;
  className?: string;
}) {
  const score = SCORE[k];
  if (score) {
    const [avgKey, nKey] = score;
    const shown = average(row[avgKey], c);
    const n = row[nKey];
    if (shown === null) {
      return <span data-testid={testId} className={cn('text-muted-foreground', className)}>{NO_VALUE}</span>;
    }
    const low = isLowN(n);
    return (
      <span
        data-testid={testId}
        data-low-n={low ? 'true' : undefined}
        className={cn('tabular-nums', low ? 'text-muted-foreground' : 'font-semibold text-foreground', className)}
      >
        {shown}{' '}<span className="text-xs font-normal text-muted-foreground">({count(n, c)})</span>
      </span>
    );
  }
  const ofKey = OF_TEACHERS[k];
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
