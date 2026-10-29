/**
 * bd-sex15q.46 (R6, ux-lead-2 174713 item 1) — a line that mixes Urdu words with Latin school names and counts. Each
 * school name (`CodeText`, `[data-code]`) becomes an atomic inline box, so a line never breaks inside it and the Urdu
 * comma or bracket next to it cannot attach to the wrong run; a count (`[data-num]`, "۹ میں سے ۶") never breaks either,
 * so its brackets stay with it. The name still wraps inside its own box if it is wider than the line.
 */
export const ISOLATE_RUNS = "[&_[data-code]]:inline-block [&_[data-num]]:whitespace-nowrap";

/** Urdu only: an English line has no direction to mix, and an atomic name would leave a ragged gap in a narrow column. */
export function isolateRuns(lang: string): string {
  return lang === "ur" ? ISOLATE_RUNS : "";
}
