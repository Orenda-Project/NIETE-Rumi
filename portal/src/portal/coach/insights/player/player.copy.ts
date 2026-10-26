/**
 * bd-sex15q.16 — the player's words. Every S4 string is m-ui's (`../copy`, generated from contracts/COPY.md §S4 and §E):
 * this file only names the subset the player uses, typed, so a missing key fails tsc here and nothing is duplicated.
 */
import type { Lang } from "../../../teacher/i18n";
import { COPY, type CopyKey } from "../copy";

/** The S4 keys (COPY §S4), as `../copy` declares them. */
export type S4Key = Extract<CopyKey, `s4.${string}`>;
/** The keys the player reads, S4 plus the clip error (COPY §E). */
export type PlayerKey = S4Key | "e.503_clip";

export const PLAYER_COPY: { readonly [K in PlayerKey]: (typeof COPY)[K] } = COPY;

/**
 * Local until COPY.md adds e.503_clip.rm; API.md A4, c-api proposal 10:22Z. The RM circle form has no full recording, so
 * `e.503_clip` ("the full recording plays from …") would promise what the RM cannot get. Remove this entry when
 * `../copy` carries the key (then `t("e.503_clip.rm", …)`).
 */
export const LOCAL_COPY = {
  "e.503_clip.rm": {
    en: "The clip could not be made. Ask the coach to bring it on Friday.",
    ur: "کلپ نہیں بن سکا۔ کوچ سے کہیں کہ جمعہ کو ساتھ لائیں۔",
  },
} as const;

export function tLocal(key: keyof typeof LOCAL_COPY, lang: Lang): string {
  return LOCAL_COPY[key][lang];
}
