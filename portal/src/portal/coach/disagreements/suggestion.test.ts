import { describe, it, expect } from "vitest";
import type { Card } from "./api";
import { copyIn } from "../../teacher/i18n";
import { COACHING } from "./coachingCopy";
import { WHATSAPP_URL_PICKER } from "@/lib/whatsapp";
import { firstName, message, stepOf, suggestedWay, template, waLink, warningsOf } from "./suggestion";

/**
 * bd-tbprit.11 — how Rifat's box picks its suggestion (her "How the suggestion is chosen"): the coach's answer to
 * "What did you find?" sets the starting way — right → message, needs help → call, doesn't fit → visit, not in the
 * recording → call — and a warning sign (the same gap in 3+ of her last 5, a 2nd or 3rd disagreement, recording
 * less) turns "needs help" from a call into a visit, as Sadia's 4-of-5 does in her prototype. "The teacher was
 * right" stays a message and "not in the recording" stays a call, in both of her cases.
 */
const pattern = (extra: Partial<NonNullable<Card["pattern"]>> = {}) => ({
  points: [], avg: null, best: null, now: null, count: 5, perWeek: 1.6, level: "steady" as const, ictAvg: 1.52,
  firstDate: null, lastDate: null, missed: { step: "We Do", n: 1, of: 5 }, earlier: 0, ...extra,
});
const card = (extra: Partial<Card> = {}) => ({ nth: 1, pattern: pattern(), moves: null, evidence: [], durationSec: 2400, ...extra }) as unknown as Card;

describe("warningsOf", () => {
  it("none for a first disagreement, a one-off gap and steady recording", () => {
    expect(warningsOf(card())).toEqual([]);
  });
  it("the same gap in 3 or more of her last lessons, a 2nd disagreement, recording less", () => {
    expect(warningsOf(card({ pattern: pattern({ missed: { step: "We Do", n: 3, of: 5 } }) }))).toEqual([{ kind: "missed", step: "We Do", n: 3, of: 5 }]);
    expect(warningsOf(card({ nth: 2 }))).toEqual([{ kind: "repeat", nth: 2 }]);
    expect(warningsOf(card({ pattern: pattern({ level: "atRisk" }) }))).toEqual([{ kind: "recordingLess" }]);
  });
  it("no pattern on the card is no warning, never a guess", () => {
    expect(warningsOf(card({ pattern: null }))).toEqual([]);
  });
});

describe("suggestedWay", () => {
  const warn = [{ kind: "repeat" as const, nth: 2 }];
  it("the starting way from her answer", () => {
    expect([0, 1, 2, 3].map((f) => suggestedWay(f, []))).toEqual(["msg", "call", "visit", "call"]);
  });
  it("a warning sign turns needs-help into a visit; right and not-recorded keep their way", () => {
    expect([0, 1, 2, 3].map((f) => suggestedWay(f, warn))).toEqual(["msg", "visit", "visit", "call"]);
  });
});

describe("stepOf, firstName", () => {
  it("the step from her pattern, else none", () => {
    expect(stepOf(card())).toBe("We Do");
    expect(stepOf(card({ pattern: pattern({ missed: null }) }))).toBeNull();
  });
  it("the first word of her name; none is an empty name", () => {
    expect(firstName("Sadia Bibi")).toBe("Sadia");
    expect(firstName(null)).toBe("");
  });
});

describe("template", () => {
  const en = copyIn(COACHING, "en");
  it("needs help: three questions, two stuck steps, three visit steps, naming the step", () => {
    const t = template(en, 1, "We Do");
    expect(t.qs).toHaveLength(3);
    expect(t.qs[0]).toContain("We Do");
    expect(t.stuck).toHaveLength(2);
    expect(t.visit).toHaveLength(3);
    expect(t.visit[0]).toContain("We Do");
    expect(t.agree).toBeTruthy();
    expect(t.check).toBeTruthy();
  });
  it("no step known: says 'this part', never an empty name", () => {
    expect(template(en, 2, null).visit[0]).toContain("this part");
  });
  it("not in the recording: questions about what happened after it stopped", () => {
    expect(template(en, 3, "We Do").qs[0]).toContain("after the recording stopped");
  });
});

describe("message", () => {
  it("Urdu, with her first name; the AI's {name} is filled the same way", () => {
    expect(message(0, "Sadia")).toMatch(/^Sadia جی، /);
    expect(message(3, "Sadia")).toContain("ریکارڈ");
    expect(message(1, "Sadia", "{name} جی، شکریہ۔")).toBe("Sadia جی، شکریہ۔");
  });
});

describe("waLink", () => {
  it("wa.me with the number and the edited text, encoded", () => {
    expect(waLink("923001234567", "سعدیہ جی & شکریہ")).toBe(`${WHATSAPP_URL_PICKER}923001234567?text=${encodeURIComponent("سعدیہ جی & شکریہ")}`);
  });
  it("no number, no link", () => {
    expect(waLink(null, "x")).toBeNull();
  });
});
