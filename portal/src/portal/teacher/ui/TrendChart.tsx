/**
 * bd-4404s7.1 — TrendChart: scores over time, oldest on the left, joined by a line, dates along the bottom. ONE chart for two
 * jobs (it replaced Analytics' BandChart, which now draws through it):
 *
 *   percentages  `points[i].value` 0–100 on a 0–100 scale (the coach's Avg. HITL Score over her visits). Two series share the
 *                line: `kind: 'hitl'` is a FILLED indigo dot, `kind: 'dc'` a HOLLOW green-ringed one (never colour alone: fill
 *                vs ring). `legend` ({ hitl, dc } words) draws the key under the chart.
 *   band rows    `rows` (Excellent on top …) and `points[i].row` the row index (the teacher's Rating over time: a word, never a
 *                number); band names run down the start edge.
 *
 * One point is a dot with no line. Dates are the screen's words (`dateLabel(iso)`): at most four shown, then first / middle / last.
 * Size 326 wide, 112 tall (164 with five band rows) and it scales to its card. An image named by `label`.
 */
export interface TrendPoint {
  date: string;
  /** Percentage mode: 0–100. */
  value?: number;
  /** Band-rows mode: the row (0 = the top row). */
  row?: number;
  kind?: 'hitl' | 'dc';
}

export interface TrendChartProps {
  points: readonly TrendPoint[];
  label: string;
  dateLabel: (iso: string) => string;
  rows?: ReadonlyArray<{ key: string; label: string }>;
  legend?: { hitl: string; dc: string };
  /** The line and dots' colour (band-rows mode): the feature the chart measures. Default indigo. */
  colour?: string;
  className?: string;
}

const W = 326;
const INK = '#33374a';
const DC = '#48b078';

export function TrendChart({ points, label, dateLabel, rows, legend, colour = INK, className }: TrendChartProps) {
  const n = points.length;
  const banded = !!rows && rows.length > 0;
  const LEFT = banded ? 84 : 16;
  const TOP = 10;
  const STEP = 26;
  const PLOT_H = banded ? STEP * (rows!.length - 1) + STEP : 78;
  const bottom = TOP + PLOT_H;
  const x = (i: number) => (banded
    ? (n === 1 ? (LEFT + W) / 2 : LEFT + 28 + (i * (W - LEFT - 50)) / (n - 1))
    : (n === 1 ? W / 2 : LEFT + (i * (W - 2 * LEFT)) / (n - 1)));
  const y = (p: TrendPoint) => (banded
    ? TOP + 13 + (p.row ?? 0) * STEP
    : TOP + (1 - Math.max(0, Math.min(100, p.value ?? 0)) / 100) * PLOT_H);
  const shown = n <= 4 ? points.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1];
  const height = bottom + 24;
  return (
    <figure className={className} style={{ margin: 0 }}>
      <svg width="100%" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label} className="block">
        {banded ? (
          <>
            <g fill="#6b7280" fontSize="10.5" fontWeight={600}>
              {rows!.map((b, i) => <text key={b.key} x={0} y={TOP + 13 + i * STEP + 4}>{b.label}</text>)}
            </g>
            <g stroke="#eef0f3" strokeWidth={1}>
              {rows!.map((b, i) => <line key={b.key} x1={LEFT} y1={TOP + 13 + i * STEP} x2={W} y2={TOP + 13 + i * STEP} />)}
            </g>
          </>
        ) : null}
        {n > 1 ? (
          <polyline
            points={points.map((p, i) => `${x(i)},${y(p)}`).join(' ')}
            fill="none"
            stroke={banded ? colour : '#c7cad6'}
            strokeWidth={banded ? 2.5 : 2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        {points.map((p, i) => {
          const dc = p.kind === 'dc';
          return banded
            ? <circle key={`${p.date}-${i}`} cx={x(i)} cy={y(p)} r={5} fill="#fff" stroke={colour} strokeWidth={2.5} />
            : <circle key={`${p.date}-${i}`} data-kind={dc ? 'dc' : 'hitl'} cx={x(i)} cy={y(p)} r={dc ? 5 : 5.5} fill={dc ? '#fff' : colour} stroke={dc ? DC : 'none'} strokeWidth={dc ? 2.5 : 0} />;
        })}
        <g fill="#6b7280" fontSize={banded ? 10.5 : 10} fontWeight={banded ? 600 : 400} textAnchor="middle">
          {shown.map((i) => <text key={`d-${i}`} x={x(i)} y={bottom + 18}>{dateLabel(points[i].date)}</text>)}
        </g>
      </svg>
      {legend && !banded ? (
        <figcaption className="mt-1 flex gap-4 text-[13px] font-semibold text-[#6b7280]">
          <span className="inline-flex items-center gap-1.5"><i aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: INK }} />{legend.hitl}</span>
          <span className="inline-flex items-center gap-1.5"><i aria-hidden="true" className="inline-block h-3 w-3 rounded-full" style={{ border: `2.5px solid ${DC}` }} />{legend.dc}</span>
        </figcaption>
      ) : null}
    </figure>
  );
}
