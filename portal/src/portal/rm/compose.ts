/**
 * bd-sex15q.17 — the follow-up picker's PREVIEW of the three lines (COPY §RM-T). The server composes and stores the
 * lines the coach receives (API §8.5); this only shows the RM what that will say, in both languages, before Send.
 * Nothing composed here is ever sent: the POST carries a template id, a W, school ids and a date (G8, A11).
 */
import type { Lang } from "../teacher/i18n";
import { dateShort, isolate } from "../coach/insights/format";
import type { Text } from "../coach/insights/types";
import { RM_COPY } from "./rm.copy";
import { rt } from "./text";
import type { TemplateId } from "./types";

export function joinSchools(names: readonly string[], lang: Lang): string {
  const n = names.map((s) => isolate(s, lang));
  if (n.length <= 1) return n[0] ?? "";
  const and = lang === "ur" ? " اور " : " and ";
  const sep = lang === "ur" ? "، " : ", ";
  return `${n.slice(0, -1).join(sep)}${and}${n[n.length - 1]}`;
}

export function composeLines(
  tid: TemplateId,
  slots: { w_short: Text; schools: readonly string[]; due_on: string; i_title: Text | null },
  lang: Lang,
): [string, string, string] {
  const vars: Record<string, string> = {
    w_short: slots.w_short[lang],
    schools: joinSchools(slots.schools, lang),
    date: dateShort(slots.due_on, lang),
    i_title: slots.i_title ? slots.i_title[lang] : rt("picker.i_title", lang),
  };
  // the templates carry no number of their own except the "4 weeks" of RM-T2, which is part of the words
  const line = (i: 1 | 2 | 3) => {
    const key = `rmt.${tid}.l${i}` as keyof typeof RM_COPY;
    return RM_COPY[key][lang].replace(/\{([a-z_]+)\}/g, (_m, k: string) => (k in vars ? vars[k] : `{${k}}`));
  };
  return [line(1), line(2), line(3)];
}

/** The W a library intervention belongs to: "I-IP-TIME-3" → "W-IP-TIME" (the library's own naming; all 77 entries hold it). */
export function wForIntervention(iId: string): string | null {
  const m = /^I-([A-Z0-9-]+?)-\d+$/.exec(iId);
  return m ? `W-${m[1]}` : null;
}

/** The default due date: this week's Friday (Karachi) if it is still ahead or today, else next Friday; never past +28 days. */
export function defaultDue(todayIso: string): string {
  const [y, m, d] = todayIso.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  const toFri = (5 - day.getUTCDay() + 7) % 7;
  day.setUTCDate(day.getUTCDate() + toFri);
  return day.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d + n));
  return day.toISOString().slice(0, 10);
}
