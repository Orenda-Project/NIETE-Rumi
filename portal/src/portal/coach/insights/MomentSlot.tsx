import { MomentPlayer } from "./player";
import type { Moment } from "./types";

/**
 * bd-sex15q.15 — where m-player's `MomentPlayer` (insights/player, variant "inline") mounts on S2 and in Listen: the kit
 * player on the clip route (never a URL from a payload, B4), on tap only, the "opens at the moment" line, the clock and
 * the chapter strip. Swapped in by m-player (bd-sex15q.16), as agreed on the board (16:34Z).
 *
 * fix-r5 s2 item 6 (red-3 073740, design-qa 072738 (2)): `preload="none"`, the kit's own default. `metadata` made the
 * browser open the clip with `bytes=0-` on page load, which the clip route logs as a play (A10), so every S2 view was a
 * logged "play" and moved the clip on Slow 3G before any tap. The full player on S4 keeps its own setting.
 */
export default function MomentSlot({ moment }: { moment: Moment }) {
  return <MomentPlayer moment={moment} variant="inline" preload="none" />;
}
