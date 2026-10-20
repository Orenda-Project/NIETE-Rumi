import type { Card, Mode, Suggestion } from "./api";
import type { COACHING } from "./coachingCopy";
import { WHATSAPP_URL_PICKER } from "@/lib/whatsapp";

/**
 * bd-tbprit.11 — how Rifat's box picks its suggestion ("How the suggestion is chosen"). Her answer to "What did you
 * find?" (0 right, 1 needs help, 2 doesn't fit, 3 not in the recording) sets the starting way; a warning sign turns
 * "needs help" from a call into a visit. "Right" stays a message and "not recorded" stays a call, as in her two
 * worked cases. The template is the general version of her examples; the AI version replaces it when it arrives.
 */

export type Warning = { kind: "missed"; step: string; n: number; of: number } | { kind: "repeat"; nth: number } | { kind: "recordingLess" };
type CoachingWords = typeof COACHING.en;

const START: Mode[] = ["msg", "call", "visit", "call"];
const HABIT = 3;

/** Only what the card says: no pattern, no warning. */
export function warningsOf(card: Card): Warning[] {
  const out: Warning[] = [];
  const m = card.pattern?.missed;
  if (m?.step && m.n >= HABIT) out.push({ kind: "missed", step: m.step, n: m.n, of: m.of });
  if (card.nth >= 2) out.push({ kind: "repeat", nth: card.nth });
  if (card.pattern?.level === "atRisk") out.push({ kind: "recordingLess" });
  return out;
}

export const suggestedWay = (found: number, warnings: Warning[]): Mode => (found === 1 && warnings.length ? "visit" : START[found]);

export const stepOf = (card: Card): string | null => card.pattern?.missed?.step ?? null;

export const firstName = (name: string | null): string => (name ?? "").trim().split(/\s+/)[0] ?? "";

const TPL_OF = ["help", "help", "fit", "notRec"] as const;

export function template(words: CoachingWords, found: number, step: string | null): Suggestion {
  const s = step ?? words.thisPart;
  const t = words.tpl[TPL_OF[found] ?? "help"];
  return { msg: "", qs: t.qs(s), stuck: t.stuck(s), agree: t.agree(s), check: t.check(s), visit: t.visit(s) };
}

/** Rifat's Urdu messages; the message goes to the teacher in Urdu whatever the coach reads. 1 and 2 are MACHINE-DRAFTED. */
const MSG = [
  "{name} جی، آپ کی بات سن لی۔ آپ درست تھیں۔ شکریہ! ہم رپورٹ دوبارہ چیک کروا رہے ہیں۔",
  "{name} جی، آپ کی بات سن لی۔ شکریہ! ہم جلد یہ موو مل کر آزمائیں گے۔",
  "{name} جی، آپ کی بات سن لی۔ شکریہ! اگلے دورے میں یہ موو آپ کی کلاس کے مطابق مل کر طے کریں گے۔",
  "{name} جی، آپ کی بات سن لی۔ یہ حصہ ریکارڈنگ میں نہیں آیا۔ اگلی بار پورا سبق ریکارڈ کریں تاکہ رپورٹ میں سب کچھ آئے۔",
];

export const message = (found: number, name: string, ai?: string | null): string =>
  (ai || MSG[found] || MSG[0]).replaceAll("{name}", name).trimStart();

export const waLink = (phone: string | null | undefined, text: string): string | null =>
  phone ? `${WHATSAPP_URL_PICKER}${phone}?text=${encodeURIComponent(text)}` : null;
