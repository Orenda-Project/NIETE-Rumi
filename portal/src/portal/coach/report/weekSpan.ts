import type { Lang } from "../../teacher/i18n";

/**
 * The days a coach's week covers, Monday to Friday, as her Home card and her week page print it: "2–6 Nov" in one month,
 * "28 Sep – 2 Oct" across two (bd-enec2e.5: it printed "28–2 Oct"). Dates are calendar days (YYYY-MM-DD), read in UTC so
 * no device clock moves them.
 */
export function weekSpan(monday: string, friday: string, lang: Lang): string {
  const fmt = (d: string, o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(lang === "ur" ? "ur-PK" : "en-GB", { ...o, timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  if (monday.slice(0, 7) === friday.slice(0, 7)) return `${fmt(monday, { day: "numeric" })}–${fmt(friday, { day: "numeric", month: "short" })}`;
  return `${fmt(monday, { day: "numeric", month: "short" })} – ${fmt(friday, { day: "numeric", month: "short" })}`;
}
