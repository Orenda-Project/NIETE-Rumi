import type { DraftSection, V6Indicator } from "../../services/api";
import type { Values } from "./formModel";

/**
 * bd-ra8xu.40 — a FICO17 v6 visit on the portal's Feedback Form: its values and its rules, the SAME as the WhatsApp v6
 * review Flow (bot/shared/services/observe/observe-fico17-v6.js validateScreen, which the bot runs again on save):
 *
 *   one of the six (combined)   r_<code> a level, why_<code> a reason of at least `minReason` letters;
 *   D2                          also d2_children and d2_quiet_later, whole numbers, quiet ≤ children; a level that is
 *                               not the one the counts give needs a number in the reason;
 *   one of Rumi's 11 (dc)       r_<code>, ev_<code>, imp_<code>; changing a level Rumi set needs chg_<letter> (the
 *                               part's "why you changed it"), at least `minReason` letters.
 */
export type V6Section = Extract<DraftSection, { kind: "v6" }>;
export type V6Problem = "chooseLevel" | "atLeast" | "checkCounts" | "sayWhyNumber";
export type V6Problems = Record<string, V6Problem>;

export const MIN_REASON = 20;

/** The values one v6 part starts from: one key per field its Flow screen submits. */
export function initialV6Values(section: V6Section): Values {
  const v: Values = {};
  for (const ind of section.indicators) {
    v[`r_${ind.field}`] = ind.rating ?? "";
    if (ind.kind === "combined") {
      v[`why_${ind.field}`] = ind.why ?? "";
      if (ind.d2) { v.d2_children = ind.d2.children ?? ""; v.d2_quiet_later = ind.d2.quietLater ?? ""; }
    } else {
      v[`ev_${ind.field}`] = ind.evidence ?? "";
      v[`imp_${ind.field}`] = ind.improvement ?? "";
    }
  }
  v[`chg_${section.letter}`] = section.changeReason ?? "";
  return v;
}

const letters = (s: string) => Array.from(String(s || "").trim()).length;
const whole = (s: string | undefined) => (/^\d+$/.test(String(s ?? "").trim()) ? Number(String(s).trim()) : null);

/** D2's level from the two counts (spec §7.4, as the bot's d2Expected). */
export function d2Expected(children: number, quietLater: number): number {
  if (children === 0) return 1;
  if (children <= 2) return 2;
  if (children <= 5) return 3;
  return quietLater >= 2 ? 4 : 3;
}

/** Did the coach change a level Rumi set, on this indicator? */
export function changedFromRumi(ind: V6Indicator, values: Values): boolean {
  if (ind.kind !== "dc" || ind.rumi == null) return false;
  const now = values[`r_${ind.field}`] ?? "";
  return now !== "" && now !== ind.rumi;
}

/** The reasons this part cannot go on yet, by field; {} when it may. */
export function v6Problems(section: V6Section, values: Values, minReason = MIN_REASON): V6Problems {
  const out: V6Problems = {};
  let changed = false;
  for (const ind of section.indicators) {
    const level = values[`r_${ind.field}`] ?? "";
    if (ind.kind === "dc") { if (changedFromRumi(ind, values)) changed = true; continue; }
    if (!ind.options.some((o) => o.id === level)) out[`r_${ind.field}`] = "chooseLevel";
    const why = values[`why_${ind.field}`] ?? "";
    if (letters(why) < minReason) out[`why_${ind.field}`] = "atLeast";
    if (ind.d2) {
      const n = whole(values.d2_children);
      const q = whole(values.d2_quiet_later);
      if (n === null || q === null || q > n) out.d2_children = "checkCounts";
      else if (/^[1-4]$/.test(level) && Number(level) !== d2Expected(n, q) && !/\d/.test(why) && !out[`why_${ind.field}`]) {
        out[`why_${ind.field}`] = "sayWhyNumber";
      }
    }
  }
  if (changed && letters(values[`chg_${section.letter}`] ?? "") < minReason) out[`chg_${section.letter}`] = "atLeast";
  return out;
}

/** An option's words: "3 · Chose 2+ times" for a level, the title alone for N/A and Couldn't tell. */
export function v6OptionText(o: { id: string; title: string }): string {
  return /^[1-4]$/.test(o.id) ? `${o.id} · ${o.title}` : o.title;
}
