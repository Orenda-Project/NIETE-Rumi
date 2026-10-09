import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * bd-fmf24g.22 — the NIETE diamond lattice (brand book v2, "Patterns", p9), redrawn as line art: thin 45° lines that
 * make big diamonds, with one small cross-shaped cluster of diamonds per tile. Never filled, one line colour, hidden
 * from assistive tech. The book has no vector original, so this is a redraw (niete-brand skill, "Build rules").
 *
 * It fades out toward the text side (the start edge: `to_right` in English, `to_left` in Urdu), so words stay on a
 * quiet ground. Size it from outside (`className`), e.g. `absolute inset-y-0 end-0 w-[70%]`.
 * Canvas: the `NieteLattice` component board.
 */
const P = 96; // half a tile
const T = P * 2;
const H = Math.round(P * 0.24);
const diamond = (cx: number, cy: number, r: number) => `M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}Z`;
const LINES = `M0 ${P}L${P} 0M0 ${T}L${T} 0M${P} ${T}L${T} ${P}M0 ${P}L${P} ${T}M0 0L${T} ${T}M${P} 0L${T} ${P}`;
const CLUSTER = [[0, 0], [H, 0], [-H, 0], [0, H], [0, -H]].map(([dx, dy]) => diamond(P + dx, P + dy, H)).join("");

export interface NieteLatticeProps {
  /** The line colour (default NIETE green). */
  line?: string;
  /** Line opacity, 0–1 (default .55). */
  strength?: number;
  /** Slides the pattern sideways, in px, so two bands do not show the same corner. */
  shift?: number;
  className?: string;
}

export function NieteLattice({ line = "#47ba7d", strength = 0.55, shift = 0, className }: NieteLatticeProps) {
  const id = `nl${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg
      data-niete-lattice=""
      aria-hidden="true"
      focusable="false"
      className={cn(
        "pointer-events-none block h-full w-full",
        "[-webkit-mask-image:linear-gradient(to_right,transparent_0%,#000_60%)] [mask-image:linear-gradient(to_right,transparent_0%,#000_60%)]",
        "rtl:[-webkit-mask-image:linear-gradient(to_left,transparent_0%,#000_60%)] rtl:[mask-image:linear-gradient(to_left,transparent_0%,#000_60%)]",
        className,
      )}
    >
      <defs>
        <pattern id={id} width={T} height={T} patternUnits="userSpaceOnUse" patternTransform={`translate(${shift} 0)`}>
          <path d={LINES + CLUSTER} fill="none" stroke={line} strokeWidth={1.25} strokeLinejoin="miter" opacity={strength} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}
