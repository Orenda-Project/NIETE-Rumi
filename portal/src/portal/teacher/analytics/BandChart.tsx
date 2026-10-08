import { BAND_ROWS, type TrendPoint } from './model';

/**
 * bd-fmf24g.8 — Rating over time on the five BAND rows (Excellent on top), never a number: one dot per
 * rated observation, oldest on the left, joined by a line. Drawn as the canvas's Analytics chart
 * (326 × 164, band names down the left, dates along the bottom).
 */
const W = 326;
const LEFT = 84;
const TOP = 10;
const STEP = 26;
const BOTTOM = TOP + STEP * (BAND_ROWS.length - 1) + STEP;

export function BandChart({ points, label, dateLabel, rows = BAND_ROWS }: { points: TrendPoint[]; label: string; dateLabel: (iso: string) => string; rows?: ReadonlyArray<{ key: string; label: string }> }) {
  const n = points.length;
  const x = (i: number) => (n === 1 ? (LEFT + W) / 2 : LEFT + 28 + (i * (W - LEFT - 50)) / (n - 1));
  const y = (row: number) => TOP + 13 + row * STEP;
  const shownDates = n <= 4 ? points.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1];
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${BOTTOM + 24}`} role="img" aria-label={label} className="block">
      <g fill="#6b7280" fontSize="10.5" fontWeight={600}>
        {rows.map((b, i) => <text key={b.key} x={0} y={y(i) + 4}>{b.label}</text>)}
      </g>
      <g stroke="#eef0f3" strokeWidth={1}>
        {BAND_ROWS.map((b, i) => <line key={b.key} x1={LEFT} y1={y(i)} x2={W} y2={y(i)} />)}
      </g>
      {n > 1 ? (
        <polyline
          points={points.map((p, i) => `${x(i)},${y(p.row)}`).join(' ')}
          fill="none" stroke="#33374a" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
        />
      ) : null}
      <g fill="#fff" stroke="#33374a" strokeWidth={2.5}>
        {points.map((p, i) => <circle key={`${p.date}-${i}`} cx={x(i)} cy={y(p.row)} r={5} />)}
      </g>
      <g fill="#6b7280" fontSize="10.5" fontWeight={600} textAnchor="middle">
        {shownDates.map((i) => <text key={`d-${i}`} x={x(i)} y={BOTTOM + 18}>{dateLabel(points[i].date)}</text>)}
      </g>
    </svg>
  );
}
