import type { DraftOption, DraftSection, ObservationDraft } from "../../services/api";

/**
 * bd-4404s7.5 — the Feedback Form's values: the SAME keys the WhatsApp review form submits, so the bot saves it through
 * the very function the form's last screen calls (portal-observe.service saveDraft → applyObserverEdits):
 *
 *   each indicator   r_<field> rating (or N/A) · ev_<field> what was seen · imp_<field> to improve
 *   her lesson plan  fid_r_<k> each move's verdict · fid_e_<k> what was seen
 *
 * Every field is sent, changed or not, exactly as the form sends its init values. (The old page,
 * pages/LeaderObserveDraft.tsx, has the same two helpers: the old UI keeps its own until it is retired.)
 */
export type Values = Record<string, string>;

/** The values the form starts from: one key per field it submits. */
export function initialValues(draft: ObservationDraft): Values {
  const v: Values = {};
  for (const s of draft.sections) {
    if (s.kind === "moves") {
      for (const m of s.moves) { v[`fid_r_${m.k}`] = m.verdict; v[`fid_e_${m.k}`] = m.evidence || ""; }
    } else {
      for (const ind of s.indicators) {
        v[`r_${ind.field}`] = ind.rating ?? "";
        v[`ev_${ind.field}`] = ind.evidence ?? "";
        v[`imp_${ind.field}`] = ind.improvement ?? "";
      }
    }
  }
  return v;
}

/** How many ratings and how many notes she changed from where the form started. */
export function countChanges(start: Values, now: Values): { ratings: number; notes: number } {
  let ratings = 0;
  let notes = 0;
  for (const k of Object.keys(now)) {
    if (now[k] === start[k]) continue;
    if (/^(r|fid_r)_/.test(k)) ratings += 1; else notes += 1;
  }
  return { ratings, notes };
}

/** An option's title by its id ("2" → "2 · Proficient"); an unknown id is shown as it is. */
export function titleOf(options: readonly DraftOption[], id: string | undefined): string {
  return (options.find((o) => o.id === id) || { title: id || "—" }).title;
}

/** A rung's own name from its option title: "1 · Developing" → "Developing"; "— Not applicable to this lesson" → "Not applicable to this lesson". */
export function rungName(title: string): string {
  return String(title || "").replace(/^[—–-]\s*/, "").replace(/^\d+\s*·\s*/, "").trim();
}

export type { DraftSection };
