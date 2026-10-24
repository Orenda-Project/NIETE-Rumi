import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { TEACHER_FRAME } from "../../copy";
import { useCopy } from "../../i18n";
import { teacherPath } from "../../routes";
import { FOCUS } from "../../ui/styles";
import type { HomeTileKey } from "../api";
import { LOOK_ICONS } from "./lookIcons";

/** The kinds whose well is green; every other feature's is slate. */
const GREEN: readonly HomeTileKey[] = ["lessons", "training", "assessment"];

/** The wells: green #e7f5ed with a #2e7d57 glyph, slate #e6e9f3 with an ink #333748 glyph (the look's two tints). */
const WELL = {
  green: "bg-[#e7f5ed] text-[#2e7d57]",
  slate: "bg-[#e6e9f3] text-[#333748]",
} as const;

/** True when `order` holds every tile exactly once. */
function isPermutation(order: readonly HomeTileKey[], tiles: readonly { key: HomeTileKey }[]): boolean {
  if (order.length !== tiles.length || new Set(order).size !== order.length) return false;
  return tiles.every(({ key }) => order.includes(key));
}

/**
 * The Home look's feature rows: eight white rows, two per line, each an icon well tinted by kind and the feature's word.
 * The grid is `[display:grid]`, never `.grid` (index.css mirrors `.grid` to LTR under Urdu). Under 344px the well and the
 * label shrink so every word stays whole at 320px; a label wraps at its spaces and only hyphenates a word that cannot fit.
 * @param tiles the features, in Home's fixed order
 * @param order the server's order; used only when it is a whole permutation of `tiles`
 */
export function FeatureRows({ tiles, order, className }: { tiles: readonly { key: HomeTileKey }[]; order?: HomeTileKey[] | null; className?: string }) {
  const C = useCopy(TEACHER_FRAME);
  const keys = order && isPermutation(order, tiles) ? order : tiles.map((t) => t.key);
  return (
    <nav aria-label={C.home.features} data-testid="feature-tiles" className={cn("[display:grid] grid-cols-2 gap-2", className)}>
      {keys.map((key) => {
        const Icon = LOOK_ICONS[key];
        return (
          <Link
            key={key}
            data-row={key}
            to={teacherPath(key)}
            className={cn(
              "flex min-h-[52px] items-center gap-2.5 rounded-[14px] border border-[#e5e7eb] bg-white px-2 py-1.5 max-[343px]:gap-2 max-[343px]:px-1.5",
              FOCUS,
            )}
          >
            <span
              data-well
              aria-hidden="true"
              className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] max-[343px]:h-8 max-[343px]:w-8", GREEN.includes(key) ? WELL.green : WELL.slate)}
            >
              <Icon size={20} />
            </span>
            <span data-label className="min-w-0 text-[14px] font-semibold text-[#333748] [overflow-wrap:anywhere] hyphens-auto max-[343px]:text-[13px]">
              {C.home.tiles[key]}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
