import { MomentPlayer } from "./player";
import type { Moment } from "./types";

/**
 * bd-sex15q.15 — where m-player's `MomentPlayer` (insights/player, variant "inline") mounts on S2 and in Listen: the kit
 * player on the clip route (never a URL from a payload, B4), on tap only, the "opens at the moment" line, the clock and
 * the chapter strip. Swapped in by m-player (bd-sex15q.16), as agreed on the board (16:34Z).
 */
export default function MomentSlot({ moment }: { moment: Moment }) {
  return <MomentPlayer moment={moment} variant="inline" />;
}
