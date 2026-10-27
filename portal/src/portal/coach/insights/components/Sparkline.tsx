/**
 * bd-sex15q.15 — S6's recordings-per-week line: an inline SVG of the values in the order given (oldest first), no
 * axis, no numbers, hidden from screen readers. The counts it draws are said in words beside it (s6.weekly.sub), so
 * the picture carries no number of its own.
 */
export function Sparkline({ values, testId = "s6-sparkline", width = 280, height = 44 }: {
  values: readonly number[]; testId?: string; width?: number; height?: number;
}) {
  const pad = 4;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  const pts = values.map((v, k) => [pad + k * step, height - pad - (v / max) * (height - pad * 2)] as const);
  const line = pts.map(([x, y], k) => `${k ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return (
    <svg
      data-testid={testId}
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${width} ${height}`}
      className="h-11 w-full rtl:-scale-x-100"
      preserveAspectRatio="none"
    >
      {pts.length > 1 && <path d={line} fill="none" stroke="#4f46e5" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
      {pts.map(([x, y], k) => <circle key={k} cx={x} cy={y} r={2.5} fill="#4f46e5" />)}
    </svg>
  );
}
