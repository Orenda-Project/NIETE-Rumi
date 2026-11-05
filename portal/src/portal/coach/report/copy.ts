/**
 * Coach reports in the app — the words of the coach's debrief report page and of its card on her Home, in English and
 * Urdu. The section headings are the ICT HITL owner's own (her prototype and the 4 Nov gap doc), so a few are longer than
 * the 4-word label rule (longOk below). Behaviour names, why-it-matters lines and the ready "Try:" lines are DATA: they
 * come in both languages from the server (bot observe-strings: names, why-it-matters, the ready Try lines), one source with the
 * WhatsApp card. The judge's own lines are in the language they were written in.
 * Urdu MACHINE-DRAFTED where it is not already the WhatsApp report's wording; waits for a native check.
 */
import { bilingual, type Bilingual, type Words } from "../../teacher/i18n";
import type { CopyEntry } from "../../teacher/copyRegistry";

export const COACH_REPORT_EN = {
  title: "Your debrief report",
  crumb: "Reports",
  eyebrow: "Your debrief",
  headlineToday: "Today’s debrief",
  headline: "Your debrief",
  behaviours: "behaviours",
  ofTotal: (n: number, t: number) => `${n} of ${t}`,
  respect: "Respect held — as always",
  marks: (t: number) => `Your ${t} behaviours`,
  tapHint: "Tap a behaviour to see what happened.",
  did: "What you did well — and how",
  missed: "What was missed this time",
  what: "What happened:",
  why: "Why it matters:",
  focus: "Next focus — just one thing",
  whyThis: "Why this one:",
  tryLabel: "Try:",
  tryPending: "Ready line to come",
  foot: "The choice is yours — you are the coach.",
  concern: "Something worth naming",
  instead: "Instead:",
  notReady: "Not ready yet",
  notYours: "Not available",
  loadFailed: "Could not load",
  tryAgain: "Try again",
  readyEyebrow: "Ready for you",
  readyDebrief: "Your debrief report",
  open: "Open my report",
  close: "Close",
};

const COACH_REPORT_UR: Words<typeof COACH_REPORT_EN> = {
  title: "آپ کی ڈی بریف رپورٹ",
  crumb: "رپورٹس",
  eyebrow: "آپ کی ڈی بریف",
  headlineToday: "آج کی ڈی بریف",
  headline: "آپ کی ڈی بریف",
  behaviours: "رویے",
  ofTotal: (n: number, t: number) => `${t} میں سے ${n}`,
  respect: "احترام برقرار رہا — ہمیشہ کی طرح",
  marks: (t: number) => `آپ کے ${t} رویے`,
  tapHint: "کسی رویے پر ٹیپ کریں اور دیکھیں کیا ہوا۔",
  did: "کیا اچھا کیا — اور کیسے",
  missed: "اس بار کیا رہ گیا",
  what: "کیا ہوا:",
  why: "کیوں اہم ہے:",
  focus: "اگلا فوکس — صرف ایک چیز",
  whyThis: "یہی کیوں:",
  tryLabel: "آزمائیں:",
  tryPending: "تیار لائن آنا باقی",
  foot: "فیصلہ آپ کا ہے — کوچ آپ ہیں۔",
  concern: "کھل کر کہنے کی بات",
  instead: "اس کے بجائے:",
  notReady: "ابھی تیار نہیں",
  notYours: "دستیاب نہیں",
  loadFailed: "لوڈ نہیں ہو سکا",
  tryAgain: "دوبارہ کوشش کریں",
  readyEyebrow: "آپ کے لیے تیار",
  readyDebrief: "آپ کی ڈی بریف رپورٹ",
  open: "میری رپورٹ کھولیں",
  close: "بند کریں",
};

export const COACH_REPORT = bilingual(COACH_REPORT_EN, COACH_REPORT_UR);
export type CoachReportCopy = Words<typeof COACH_REPORT_EN>;

export const COPY_ENTRY: CopyEntry = {
  screen: "Coach debrief report",
  module: COACH_REPORT as Bilingual<unknown>,
  // title / readyDebrief / concern: the WhatsApp report's own wording («آپ کی ڈی بریف رپورٹ», «کھل کر کہنے کی بات»).
  longOk: ["title", "readyDebrief", "concern", "respect", "tapHint", "did", "missed", "focus", "foot"],
};
