import { cn } from '@/lib/utils';

/**
 * bd-97x22y.5 — the ICT dashboard's grouped bar chart (her SectorScoreComparisonChart: one group per sector, one bar
 * per series, her legend on top, a 0–100 axis with dashed grid lines, each bar labelled with its value in its series
 * colour). Any tab that compares a few series across the sectors can use it.
 *
 * Plain HTML, like BarChart.tsx: the values stay real text (the page test reads them), nothing needs a chart library,
 * and a phone gets its own layout — `rows`: one block per group with a horizontal bar per series, because eighteen
 * labelled columns do not fit 390px. A missing value (null) draws no bar and reads "—".
 */
export interface ChartSeries {
  key: string;
  label: string;
  /** The bar's fill and the legend swatch. */
  colour: string;
  /** The value label's colour (readable on white). */
  text: string;
}

export interface ChartGroup {
  key: string;
  label: string;
  values: Record<string, number | null>;
}

const PLOT_PX = 200;
/** Room above the plot for a full bar's value label. */
const HEAD_PX = 18;

export function GroupedBarChart({ testId, label, series, groups, format, empty, axisLabel, max = 100, ticks = [0, 25, 50, 75, 100], layout = 'columns', score, selected }: {
  testId: string;
  label: string;
  series: ChartSeries[];
  groups: ChartGroup[];
  /** A value as shown ("71%"). */
  format: (v: number) => string;
  /** What a missing value reads. */
  empty: string;
  axisLabel?: string;
  max?: number;
  ticks?: number[];
  layout?: 'columns' | 'rows';
  /** The chart's values are FICO / HITL scores: the only numbers the page shows with a %. */
  score?: 'fico' | 'hitl';
  /** A chosen group: the others step back. */
  selected?: string | null;
}) {
  const chosen = selected?.toLowerCase() ?? null;
  const quiet = (g: ChartGroup) => chosen !== null && g.key.toLowerCase() !== chosen;
  const share = (v: number) => Math.max(0, Math.min(1, v / max));

  const legend = (
    <ul data-testid="chart-legend" className="mb-4 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-xs font-semibold text-foreground">
      {series.map((s) => (
        <li key={s.key} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-[3px]" style={{ backgroundColor: s.colour }} />
          {s.label}
        </li>
      ))}
    </ul>
  );

  if (layout === 'rows') {
    return (
      <figure data-testid={testId} data-score={score} aria-label={label} className="min-w-0">
        {legend}
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <div key={g.key} data-testid={`group-${g.key}`} className={cn('transition-opacity', quiet(g) && 'opacity-40')}>
              <p className="mb-1.5 text-sm font-bold text-foreground">{g.label}</p>
              <div className="flex flex-col gap-1.5">
                {series.map((s) => {
                  const v = g.values[s.key];
                  return (
                    <div key={s.key} data-testid={`bar-${g.key}-${s.key}`} className="flex items-center gap-2" title={`${g.label} · ${s.label}`}>
                      <span aria-hidden="true" className="relative h-3 flex-1 overflow-hidden rounded-full bg-secondary">
                        {v !== null ? <span className="absolute inset-y-0 start-0 rounded-full" style={{ width: `${share(v) * 100}%`, backgroundColor: s.colour }} /> : null}
                      </span>
                      <span data-testid="bar-value" className="w-11 shrink-0 text-end text-xs font-bold tabular-nums" style={{ color: v === null ? undefined : s.text }}>
                        {v === null ? empty : format(v)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </figure>
    );
  }

  return (
    <figure data-testid={testId} data-score={score} aria-label={label} className="min-w-0">
      {legend}
      <div className="flex gap-2">
        {axisLabel ? (
          <span className="flex w-4 shrink-0 items-center justify-center" style={{ height: HEAD_PX + PLOT_PX, paddingTop: HEAD_PX }}>
            <span className="-rotate-90 whitespace-nowrap text-[11px] font-semibold text-muted-foreground">{axisLabel}</span>
          </span>
        ) : null}
        {/* The axis: her ticks, right-aligned against the plot. */}
        <div aria-hidden="true" className="relative w-9 shrink-0" style={{ height: HEAD_PX + PLOT_PX }}>
          {ticks.map((t) => (
            <span key={t} className="absolute end-1 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground" style={{ top: HEAD_PX + PLOT_PX * (1 - share(t)) }}>
              {format(t)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0" style={{ height: HEAD_PX + PLOT_PX }}>
            {ticks.map((t) => (
              <span key={t} className={cn('absolute inset-x-0 border-t', t === 0 ? 'border-border' : 'border-dashed border-border/80')} style={{ top: HEAD_PX + PLOT_PX * (1 - share(t)) }} />
            ))}
          </div>
          <div className="relative flex gap-2 sm:gap-4">
            {groups.map((g) => (
              <div key={g.key} data-testid={`group-${g.key}`} className={cn('flex min-w-0 flex-1 flex-col items-center transition-opacity', quiet(g) && 'opacity-40')}>
                <div className="flex w-full items-end justify-center gap-1" style={{ height: HEAD_PX + PLOT_PX }}>
                  {series.map((s) => {
                    const v = g.values[s.key];
                    const h = v !== null && v > 0 ? Math.max(2, Math.round(PLOT_PX * share(v))) : 0;
                    return (
                      <div key={s.key} data-testid={`bar-${g.key}-${s.key}`} title={`${g.label} · ${s.label}`} className="flex min-w-0 max-w-[40px] flex-1 flex-col items-center justify-end">
                        <span data-testid="bar-value" className="mb-0.5 whitespace-nowrap text-[11px] font-bold tabular-nums" style={{ color: v === null ? undefined : s.text }}>
                          {v === null ? empty : format(v)}
                        </span>
                        {h > 0 ? <span data-testid="bar-fill" className="block w-full rounded-t-[4px]" style={{ height: h, backgroundColor: s.colour }} /> : null}
                      </div>
                    );
                  })}
                </div>
                <span className="mt-2 w-full break-words text-center text-xs font-semibold leading-tight text-foreground sm:text-sm">{g.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}
