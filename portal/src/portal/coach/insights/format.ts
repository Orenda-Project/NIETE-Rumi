/**
 * bd-sex15q.15 — COACHIP's one formatter (contracts/COPY.md §F). Payloads carry ISO dates and numbers only; every
 * weekday, month, date, range, "n of d", clock and plural on a coach screen is written here, in English or Urdu.
 *
 *   Urdu digits are the Urdu set U+06F0..U+06F9 (never the Arabic-Indic U+0660 set); codes, school names in Latin
 *   letters and the player clock are LTR atoms, wrapped in LRI…PDI inside an Urdu string (COPY §0 rules 2-3).
 *   A date is a calendar day: it is read as a day, never through the device's time zone.
 */
import type { Lang } from "../../teacher/i18n";

export const LRI = "⁦";
export const PDI = "⁩";

const URDU_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const WEEKDAYS: Record<Lang, readonly string[]> = {
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  ur: ["اتوار", "پیر", "منگل", "بدھ", "جمعرات", "جمعہ", "ہفتہ"],
};
const MONTHS: Record<Lang, readonly string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  ur: ["جنوری", "فروری", "مارچ", "اپریل", "مئی", "جون", "جولائی", "اگست", "ستمبر", "اکتوبر", "نومبر", "دسمبر"],
};

/** A number in the active script. */
export function digits(n: number | string, lang: Lang): string {
  const s = String(n);
  return lang === "ur" ? s.replace(/[0-9]/g, (c) => URDU_DIGITS[Number(c)]) : s;
}

/** An LTR atom (a code, a Latin school name, a clock) inside an Urdu string. */
export function isolate(s: string, lang: Lang): string {
  return lang === "ur" && /[A-Za-z0-9]/.test(s) ? `${LRI}${s}${PDI}` : s;
}

function parts(iso: string): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) throw new Error(`not an ISO date: ${iso}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** Weekday of a calendar day (UTC arithmetic on the day itself, so no device zone can move it). */
export function weekday(iso: string, lang: Lang): string {
  const { y, m, d } = parts(iso);
  return WEEKDAYS[lang][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** Today in Asia/Karachi, as an ISO day (UTC+5, no daylight saving). */
export function todayKarachi(now: Date = new Date()): string {
  return new Date(now.getTime() + 5 * 3600 * 1000).toISOString().slice(0, 10);
}

/** `{date_short}`: "28 Oct" / "۲۸ اکتوبر". */
export function dateShort(iso: string, lang: Lang): string {
  const { m, d } = parts(iso);
  return `${digits(d, lang)} ${MONTHS[lang][m - 1]}`;
}

/** `{date}`: "Wed 28 Oct" / "بدھ ۲۸ اکتوبر"; the year only when it is not today's. */
export function dateLong(iso: string, lang: Lang, today: string = todayKarachi()): string {
  const { y } = parts(iso);
  const year = y !== parts(today).y ? ` ${digits(y, lang)}` : "";
  return `${weekday(iso, lang)} ${dateShort(iso, lang)}${year}`;
}

/** `{range}`: "28 Sep to 25 Oct" / "۲۸ ستمبر تا ۲۵ اکتوبر". */
export function range(from: string, to: string, lang: Lang): string {
  return lang === "ur" ? `${dateShort(from, lang)} تا ${dateShort(to, lang)}` : `${dateShort(from, lang)} to ${dateShort(to, lang)}`;
}

/** `{n} of {d}`: d first in Urdu. */
export function nOfD(n: number, d: number, lang: Lang): string {
  return lang === "ur" ? `${digits(d, lang)} میں سے ${digits(n, lang)}` : `${n} of ${d}`;
}

const clock = (s: number) => {
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

/** `{mm:ss}`: ASCII in both languages (an LTR atom, isolated in Urdu). */
export function mmss(seconds: number, lang: Lang): string {
  return isolate(clock(seconds), lang);
}

/** `{dur}` on the Listen button: "0:38" / "۰:۳۸". */
export function durButton(seconds: number, lang: Lang): string {
  return digits(clock(seconds), lang);
}

/** `{weeks}`: "4 weeks" / "۴ ہفتے". */
export function weeks(w: number, lang: Lang): string {
  return lang === "ur" ? `${digits(w, lang)} ہفتے` : `${w} weeks`;
}

/** "1 recording" / "n recordings". */
export function recordings(n: number, lang: Lang): string {
  if (lang === "ur") return n === 1 ? "۱ ریکارڈنگ" : `${digits(n, lang)} ریکارڈنگز`;
  return n === 1 ? "1 recording" : `${n} recordings`;
}

export type FillValue = string | number;

/**
 * Fill a COPY template's `{tokens}`: numbers in the active script, Latin atoms isolated in Urdu. A token the caller
 * did not pass is a bug, never a blank on screen.
 */
export function fill(template: string, vars: Record<string, FillValue>, lang: Lang): string {
  return template.replace(/\{([a-z0-9_:]+)\}/g, (_, k: string) => {
    if (!(k in vars)) throw new Error(`copy token {${k}} missing`);
    const v = vars[k];
    return typeof v === "number" ? digits(v, lang) : isolate(v, lang);
  });
}
