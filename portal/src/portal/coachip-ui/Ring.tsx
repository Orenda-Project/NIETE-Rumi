import type { CSSProperties, ReactNode } from "react";
import { RING, type RingSize } from "./tokens";

/**
 * bd-sex15q.42 — the ring (DESIGN_SYSTEM §5): n of d of lessons or schools as an arc from 12 o'clock, round caps. A zero
 * (or a d of 0) draws the track only: no arc, no dot, nothing that reads as a score. The track and the centre number's
 * colour come from `--cp-ring-track` / `--cp-ring-num`, so the same ring is white-on-navy in the band and navy-on-white
 * on a card and on the laptop. Never put a ring on a teacher or a coach row (§6).
 *
 * Any `data-*` prop passes through to the root, so a caller can make the ring itself the count node.
 */
export function Ring({ n, d, size = "card", children, className, testId, ...rest }: {
  n: number; d: number; size?: RingSize; children?: ReactNode; className?: string; testId?: string;
} & { [k: `data-${string}`]: string | number | undefined }) {
  const { size: px, stroke } = RING[size];
  const r = (px - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = d > 0 ? Math.min(1, Math.max(0, n / d)) : 0;
  const arc = c * frac;
  return (
    <span
      {...rest}
      data-testid={testId}
      data-ring={size}
      className={`relative inline-flex shrink-0 items-center justify-center ${className ?? ""}`}
      style={{ width: px, height: px }}
    >
      <svg width={px} height={px} viewBox={`0 0 ${px} ${px}`} aria-hidden="true" className="absolute inset-0">
        <circle cx={px / 2} cy={px / 2} r={r} fill="none" strokeWidth={stroke} style={{ stroke: "var(--cp-ring-track)" }} />
        {arc > 0 && (
          <circle
            data-arc=""
            className="cp-ring__arc"
            cx={px / 2}
            cy={px / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${arc.toFixed(2)} ${c.toFixed(2)}`}
            transform={`rotate(-90 ${px / 2} ${px / 2})`}
            style={{ stroke: "var(--cp-green)", "--cp-arc-len": arc.toFixed(2) } as CSSProperties}
          />
        )}
      </svg>
      {children}
    </span>
  );
}
