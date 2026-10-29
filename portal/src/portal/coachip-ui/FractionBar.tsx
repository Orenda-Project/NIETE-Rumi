/**
 * bd-sex15q.42 — a 4 px fraction bar under or beside a row's number (DESIGN_SYSTEM §5): green fill on the grey track;
 * `tone="grey"` for the smaller cause on S2's Why. It fills from the inline start, so from the right in Urdu. A zero
 * draws the track only. Decorative: the count node beside it carries the number.
 */
export function FractionBar({ n, d, tone = "green", className }: { n: number; d: number; tone?: "green" | "grey"; className?: string }) {
  const pct = d > 0 ? Math.min(100, Math.max(0, (n / d) * 100)) : 0;
  return (
    <span aria-hidden="true" data-bar={`${n}/${d}`} className={`block h-1 overflow-hidden rounded-full bg-cp-track ${className ?? ""}`}>
      {pct > 0 && <span data-fill="" className={`block h-full rounded-full ${tone === "grey" ? "bg-cp-ink-3" : "bg-cp-green"}`} style={{ width: `${pct}%` }} />}
    </span>
  );
}
