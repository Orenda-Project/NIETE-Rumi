/**
 * bd-sex15q.15 — S6's recordings-per-week line: an inline SVG of the values in the order given (oldest first), no
 * axis, no numbers, hidden from screen readers. The counts it draws are said in words beside it (s6.weekly.sub), so
 * the picture carries no number of its own.
 *
 * R6 (bd-sex15q.46, SCREENS.md S6): a 1.5 px green line on a hairline grid (three rules), colours from the `.cp`
 * tokens; the last week's point is the one dot.
 */
export function Sparkline({ values, testId = "s6-sparkline", width = 280, height = 56 }: {
  values: readonly number[]; testId?: string; width?: number; height?: number;
}) {
  const pad = 6;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  const pts = values.map((v, k) => [pad + k * step, height - pad - (v / max) * (height - pad * 2)] as const);
  const line = pts.map(([x, y], k) => `${k ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const grid = [pad, height / 2, height - pad];
  const last = pts.length ? pts[pts.length - 1] : null;
  return (
    <svg
      data-testid={testId}
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${width} ${height}`}
      className="h-14 w-full overflow-visible rtl:-scale-x-100"
      preserveAspectRatio="none"
    >
      {grid.map((y) => (
        <line key={y} data-grid="" x1={0} x2={width} y1={y} y2={y} stroke="var(--cp-hairline)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      ))}
      {pts.length > 1 && <path d={line} fill="none" stroke="var(--cp-green)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
      {last && <circle cx={last[0]} cy={last[1]} r={3} fill="var(--cp-green)" />}
    </svg>
  );
}
