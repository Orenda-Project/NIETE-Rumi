import type { ChipData } from "../../teacher/ui";

/**
 * bd-4404s7.6 — a school's last visit as a status tone (COACH.md §0b, "Pick a school"): amber (waiting) for none
 * or more than 30 days, grey (info) for 8 to 30 days, green (done) within a week. Status tones only: never a
 * feature or grade colour.
 */
export type VisitTone = "waiting" | "info" | "done";

export function visitTone(days: number | null | undefined): VisitTone {
  if (days == null || days > 30) return "waiting";
  if (days >= 8) return "info";
  return "done";
}

export function visitChip(days: number | null | undefined, words: { noVisitsYet: string; today: string; daysAgo: (n: number) => string }): ChipData {
  const text = days == null ? words.noVisitsYet : days <= 0 ? words.today : words.daysAgo(days);
  return { text, tone: visitTone(days) };
}
