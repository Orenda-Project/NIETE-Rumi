/**
 * bd-sex15q.16 — the player's words. Every S4 string is m-ui's (`../copy`, generated from contracts/COPY.md §S4 and §E):
 * this file only names the subset the player uses, typed, so a missing key fails tsc here and nothing is duplicated.
 */
import { COPY, type CopyKey } from "../copy";

/** The S4 keys (COPY §S4), as `../copy` declares them. */
export type S4Key = Extract<CopyKey, `s4.${string}`>;
/** The keys the player reads, S4 plus the clip errors (COPY §E). */
export type PlayerKey = S4Key | "e.503_clip" | "e.503_clip.rm";

export const PLAYER_COPY: { readonly [K in PlayerKey]: (typeof COPY)[K] } = COPY;
