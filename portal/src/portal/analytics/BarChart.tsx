import { cn } from '@/lib/utils';

/**
 * bd-97x22y.2 — the ICT dashboard's per-sector bar chart, drawn in our tokens: one bar per region, in sector order,
 * every bar labelled with its value (six bars — a direct label each, no axis to read off), the n under the region
 * where there is one. One series, so no legend; the section's eyebrow names it.
 *
 * Plain HTML, no chart library: six bars need none, the values stay real text (the % rule and the numbers are
 * checked by the page test), and a phone gets the same chart. Bars are the kit's progress green on a recessive
 * baseline; when a region is chosen the others step back. A sector with no value has no bar and reads "—".
 */
export interface ChartBar {
  key: string;
  label: string;
  /** The bar's length; null = nothing to draw. */
  value: number | null;
  /** The label over the bar ("229", "65.3%", "—"). */
  display: string;
  /** Under the region's name ("64 scored"). */
  sub?: string;
  /** Fewer than 3 scored: drawn quieter. */
  muted?: boolean;
  /** A FICO / HITL score (the only values with a %). */
  score?: 'fico' | 'hitl';
}

const PLOT_PX = 168;

export function BarChart({ testId, label, bars, max, selected }: {
  testId: string;
  label: string;
  bars: ChartBar[];
  /** The top of the scale: 100 for a score, else the biggest bar. */
  max?: number;
  selected?: string | null;
}) {
  const top = max ?? Math.max(1, ...bars.map((b) => b.value ?? 0));
  const chosen = selected?.toLowerCase() ?? null;
  return (
    <figure data-testid={testId} aria-label={label} className="rounded-2xl border border-border bg-white px-3 pb-4 pt-5 shadow-sm sm:px-6">
      <div className="relative flex gap-2 sm:gap-5">
        {/* The baseline the bars stand on. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 border-t border-border" style={{ top: PLOT_PX + 22 }} />
        {bars.map((b) => {
          const quiet = chosen !== null && b.key.toLowerCase() !== chosen;
          const h = b.value !== null && b.value > 0 ? Math.max(3, Math.round((PLOT_PX * Math.min(b.value, top)) / top)) : 0;
          return (
            <div
              key={b.key}
              data-testid={`column-${b.key}`}
              title={[b.label, b.display, b.sub].filter(Boolean).join(' · ')}
              className={cn('flex min-w-0 flex-1 flex-col items-center transition-opacity', quiet && 'opacity-40')}
            >
              <div className="flex w-full flex-col items-center justify-end" style={{ height: PLOT_PX + 22 }}>
                <span
                  data-testid="bar-value"
                  data-score={b.score}
                  className={cn('mb-1 whitespace-nowrap text-xs font-bold tabular-nums sm:text-sm', b.muted || b.value === null ? 'text-muted-foreground' : 'text-foreground')}
                >
                  {b.display}
                </span>
                {h > 0 ? (
                  <div
                    data-testid="bar-fill"
                    className={cn('w-full max-w-[56px] rounded-t-[4px]', b.muted ? 'bg-nu-progress/45' : 'bg-nu-progress')}
                    style={{ height: h }}
                  />
                ) : null}
              </div>
              <span className="mt-2 w-full break-words text-center text-[11px] font-semibold leading-tight text-foreground sm:text-sm">{b.label}</span>
              {b.sub ? <span data-testid="bar-sub" className="mt-0.5 text-center text-[10px] leading-tight text-muted-foreground sm:text-xs">{b.sub}</span> : null}
            </div>
          );
        })}
      </div>
    </figure>
  );
}
