/**
 * bd-fmf24g.1 — small display helpers for the teacher v2 frame and pages.
 * Data, not copy: her name, phone and school come from the API as they are.
 */

/** Her name as one string. The API puts the whole of users.name in firstName; lastName is usually empty. */
export function fullName(user: { firstName?: string | null; lastName?: string | null } | null | undefined): string {
  return [user?.firstName, user?.lastName].map((p) => String(p || "").trim()).filter(Boolean).join(" ");
}

/** "AB" from "Ayesha Bibi"; one letter for a single name. Code-point aware (Urdu names too). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const first = [...words[0]][0] || "";
  const last = words.length > 1 ? [...words[words.length - 1]][0] || "" : "";
  return (first + last).toUpperCase();
}

/**
 * A phone the local way, "0300 1234567", from what the users table holds (923001234567).
 * The same rule as the coach app (coach/ui.tsx formatPhone, bd-o15qnr.14): a Pakistani
 * mobile reads 03xx; anything else keeps its +country form; junk is null.
 */
export function formatPhone(value: string | null | undefined): string | null {
  const s = String(value == null ? "" : value).replace(/[\s-]/g, "");
  if (!/^\+?\d{10,15}$/.test(s)) return null;
  const d = s.replace(/^\+/, "");
  const local = /^923\d{9}$/.test(d) ? `0${d.slice(2)}` : /^03\d{9}$/.test(d) ? d : null;
  return local ? `${local.slice(0, 4)} ${local.slice(4)}` : `+${d}`;
}

/** A school name worth showing; an empty or placeholder value shows nothing (never "—" or "N/A"). */
export function cleanSchool(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s || /^(n\/?a|none|null|unknown|-+|—)$/i.test(s)) return null;
  return s;
}

const WEEKDAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_UR = ["اتوار", "پیر", "منگل", "بدھ", "جمعرات", "جمعہ", "ہفتہ"];
const MONTHS_UR = ["جنوری", "فروری", "مارچ", "اپریل", "مئی", "جون", "جولائی", "اگست", "ستمبر", "اکتوبر", "نومبر", "دسمبر"];

/** Today in Pakistan, "Thu 8 Oct" (the canvas's date chip); in Urdu "جمعرات 8 اکتوبر" (Western digits, as the bot). */
export function todayLabel(now: Date = new Date(), lang: "en" | "ur" = "en"): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi", weekday: "short", day: "numeric", month: "short",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  if (lang !== "ur") return `${get("weekday")} ${get("day")} ${get("month")}`;
  const month = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", month: "numeric" }).format(now));
  return `${WEEKDAYS_UR[WEEKDAYS_EN.indexOf(get("weekday"))]} ${get("day")} ${MONTHS_UR[month - 1]}`;
}
