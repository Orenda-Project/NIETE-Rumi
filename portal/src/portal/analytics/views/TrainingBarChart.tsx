import { cn } from '@/lib/utils';

/**
 * bd-97x22y.4 — her grouped bar charts (recharts BarChart in TrainingComparisonChart.jsx and OxbridgeFunnelContent.jsx),
 * drawn in plain HTML like the v6 BarChart: no chart library, the values stay real text.
 *
 *   percent  her sector comparison: a group per sector, a bar per level, 0–100% axis with "% of Teachers", the % over
 *            each bar in the bar's colour, the sector names slanted (-45°), the legend on top.
 *   count    her Oxbridge / Beaconhouse panels: a group per session or subject, Middle and High bars, a count axis.
 *
 * A phone gets the same chart inside its own sideways scroll (the page itself never scrolls sideways).
 */
export interface ChartSeries {
  key: string;
  label: string;
  color: string;
}

export interface ChartGroup {
  key: string;
  label: string;
}

export interface ChartCell {
  /** 0–100 in percent mode, a count otherwise. */
  value: number;
  /** Over the bar (percent mode); '' draws no label. */
  label: string;
  /** The bar's tooltip. */
  title: string;
}

const PLOT_PX = 250;

/** The top of a count axis: four equal steps of a round size (7 → 8, 37 → 40, 1198 → 1200). */
function niceTop(max: number): number {
  if (max <= 4) return 4;
  const unit = 10 ** Math.floor(Math.log10(max / 4));
  return Math.ceil(max / (4 * unit)) * 4 * unit;
}

export function TrainingBarChart({ testId, label, mode, groups, series, cell, axisLabel, slanted = false, legend = 'square', selected = null, minWidth = 0 }: {
  testId: string;
  label: string;
  mode: 'percent' | 'count';
  groups: ChartGroup[];
  series: ChartSeries[];
  cell: (group: string, series: string) => ChartCell;
  /** The y axis's name (hers: "% of Teachers"). */
  axisLabel?: string;
  slanted?: boolean;
  legend?: 'square' | 'circle';
  /** The chosen sector: the others step back. */
  selected?: string | null;
  /** The chart's least width; narrower screens scroll it sideways. */
  minWidth?: number;
}) {
  const values = groups.flatMap((g) => series.map((s) => cell(g.key, s.key).value));
  const top = mode === 'percent' ? 100 : niceTop(Math.max(0, ...values));
  const ticks = [4, 3, 2, 1, 0].map((i) => (top * i) / 4);
  const tickText = (v: number) => (mode === 'percent' ? `${v}%` : String(v));
  const chosen = selected?.toLowerCase() ?? null;

  return (
    <figure data-testid={testId} aria-label={label} className="min-w-0">
      <ul aria-label={label} className="mb-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        {series.map((s) => (
          <li key={s.key} data-testid="legend-item" className="inline-flex items-center gap-1.5 text-xs" style={{ color: s.color }}>
            <span aria-hidden="true" className={cn('inline-block h-2.5 w-2.5 shrink-0', legend === 'circle' ? 'rounded-full' : 'rounded-[1px]')} style={{ backgroundColor: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>

      <div className="overflow-x-auto">
        {/* room above the plot for the top tick and the labels over a full bar (the scroller clips both ways) */}
        <div className="pt-5" style={{ minWidth }}>
          <div className="flex">
            {axisLabel ? (
              <div data-axis="y" aria-hidden="true" className="flex w-6 shrink-0 items-center justify-center" style={{ height: PLOT_PX }}>
                <span className="-rotate-90 whitespace-nowrap text-xs text-gray-500">{axisLabel}</span>
              </div>
            ) : null}
            <div data-axis="y" className="relative w-10 shrink-0" style={{ height: PLOT_PX }}>
              {ticks.map((v) => (
                <span
                  key={v}
                  data-testid="y-tick"
                  className="absolute end-1.5 -translate-y-1/2 text-[11px] tabular-nums text-gray-500"
                  style={{ top: `${100 - (v / top) * 100}%` }}
                >
                  {tickText(v)}
                </span>
              ))}
            </div>
            <div className="relative flex-1 border-s border-gray-300" style={{ height: PLOT_PX }}>
              {ticks.map((v) => (
                <div
                  key={v}
                  aria-hidden="true"
                  className={cn('pointer-events-none absolute inset-x-0', v === 0 ? 'border-t border-gray-300' : 'border-t border-dashed border-gray-200')}
                  style={{ top: `${100 - (v / top) * 100}%` }}
                />
              ))}
              <div className="absolute inset-0 flex items-end">
                {groups.map((g) => {
                  const quiet = chosen !== null && g.key.toLowerCase() !== chosen;
                  return (
                    <div
                      key={g.key}
                      data-testid={`group-${g.key}`}
                      className={cn('flex h-full min-w-0 flex-1 items-end justify-center gap-[3px] px-[5%] transition-opacity', quiet && 'opacity-40')}
                    >
                      {series.map((s) => {
                        const v = cell(g.key, s.key);
                        const h = Math.max(0, Math.min(100, (v.value / top) * 100));
                        return (
                          <div
                            key={s.key}
                            data-testid={`bar-${g.key}-${s.key}`}
                            title={v.title}
                            className="relative min-w-[6px] max-w-[30px] flex-1 rounded-t-[4px]"
                            style={{ height: `${h}%`, backgroundColor: s.color }}
                          >
                            {mode === 'percent' ? (
                              <span
                                data-testid="bar-label"
                                data-pct="passed"
                                className="absolute bottom-full left-1/2 mb-0.5 -translate-x-1/2 whitespace-nowrap text-[9px] font-medium tabular-nums"
                                style={{ color: s.color }}
                              >
                                {v.label}
                              </span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="flex" style={{ paddingInlineStart: axisLabel ? 64 : 40 }}>
            {groups.map((g) => (
              <div key={g.key} className={cn('relative min-w-0 flex-1', slanted ? 'h-16' : 'pt-1.5 text-center')}>
                <span
                  data-testid="x-label"
                  className={cn(
                    'text-xs text-gray-600',
                    slanted ? 'absolute end-1/2 top-2 origin-top-right -rotate-45 whitespace-nowrap' : 'block truncate',
                  )}
                >
                  {g.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}
