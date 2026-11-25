import { describe, it, expect } from "vitest";
import { collectCopy, copyProblem } from "../../newui/checks/rules";
import { untranslated } from "../../teacher/i18n";
import { OBSERVE, SAME, SENTENCES } from "./copy";
import { dayShort, failureWords, lengthShort, noteClock, observationLine, recClock } from "./format";

/**
 * bd-4404s7.4 — the Observe words: Urdu complete (none empty, none still English), every value a label but the named
 * sentences, the locked vocabulary, "observation" and never "lesson" for the coach's observation.
 */
describe("Observe copy", () => {
  // bd-ih6cej: the recording-step lines speak of recording, never "lesson" (main's copy guard; one word set everywhere).
  it("the recording-step lines never say 'lesson'", () => {
    for (const lang of ["en"] as const) {
      expect(OBSERVE[lang].weakInternet).not.toMatch(/lesson/i);
      expect(OBSERVE[lang].uploadOnlyLine).not.toMatch(/lesson/i);
    }
  });

  it("the Urdu is complete: none empty, none still the English", () => {
    expect(untranslated(OBSERVE, SAME)).toEqual([]);
  });

  it("every value is a label (4 words at most, no sentence) but the named sentences, in both languages", () => {
    for (const lang of ["en", "ur"] as const) {
      const bad = collectCopy(OBSERVE[lang])
        .filter((c) => !SENTENCES.some((p) => c.path.startsWith(p)))
        .filter((c) => copyProblem(c.text))
        .map((c) => `${lang} ${c.path}: ${c.text}`);
      expect(bad).toEqual([]);
    }
  });

  it("the words the operator decided", () => {
    expect(OBSERVE.en.startRecording).toBe("Start recording");
    expect(OBSERVE.ur.startRecording).toBe("ریکارڈنگ شروع کریں");
    expect(OBSERVE.en.uploadRecording).toBe("Upload recording");
    expect(OBSERVE.en.recordTitle).toBe("Record observation");
    expect(OBSERVE.en.sendObservation).toBe("Send observation");
    expect(OBSERVE.en.sent).toBe("Observation sent");
    expect(OBSERVE.en.couldntSend).toBe("Couldn't send");
    expect(OBSERVE.en.observationOf("Ayesha Bibi")).toBe("Ayesha Bibi’s observation");
    expect(OBSERVE.en.leaveSub).toBe("The observation keeps sending in the background.");
  });

  // bd-ra8xu.60 — Observation Notes on Record and Check and send: the operator's words (the Urdu a draft for native review).
  it("the Observation Notes words, in both languages, never naming the bot", () => {
    const pick = (c: typeof OBSERVE.en) => [c.notesTitle, c.notesHint, c.notesPlaceholder, c.addNote, c.notesMore];
    expect(pick(OBSERVE.en)).toEqual([
      "Observation Notes", "What the recording can't hear: the board, group work, who stayed quiet.", "Type what you see…", "Add",
      "Anything else you saw?",
    ]);
    expect(pick(OBSERVE.ur)).toEqual([
      "مشاہدے کے نوٹس", "جو ریکارڈنگ میں سنائی نہیں دیتا: بورڈ، گروپ کا کام، کون خاموش رہا۔", "جو دیکھ رہے ہیں لکھیں…", "شامل کریں",
      "اور کچھ جو آپ نے دیکھا؟",
    ]);
    for (const lang of ["en", "ur"] as const) expect(pick(OBSERVE[lang]).join(" ")).not.toMatch(/Rumi|رومی/);
  });

  it("a note's recording clock: 'MM:SS' as the bot keeps it; Urdu digits kept left-to-right in Urdu", () => {
    expect(recClock(1_122_000)).toBe("18:42");
    expect(recClock(4_000)).toBe("00:04");
    expect(recClock(3_725_000)).toBe("62:05"); // past an hour the minutes run on, as the bot's 'MM:SS' reads them
    expect(noteClock("12:40", "en")).toBe("12:40");
    expect(noteClock("12:40", "ur")).toBe("⁦۱۲:۴۰⁩");
  });

  it("the ontology's Never list: no 'Record live', no 'بھیج دیا', no 'استاد', no 'Logout'", () => {
    const all = (lang: "en" | "ur") => collectCopy(OBSERVE[lang]).map((c) => c.text).join("\n");
    expect(all("en")).not.toMatch(/Record live|Attach recording|Choose file|Board photos/);
    expect(all("ur")).not.toMatch(/بھیج دیا|بھیجے|استاد/);
  });

  it("'lesson' is left only for the lesson the teacher taught, and a lesson plan", () => {
    const hits = collectCopy(OBSERVE.en).filter((c) => /lesson/i.test(c.text) && !/lesson plan|whole lesson/i.test(c.text));
    expect(hits).toEqual([]);
  });
});

describe("the day and length of an observation", () => {
  it("'Tue 6 Oct' and '38 min', in her language", () => {
    expect(dayShort("2026-10-06", OBSERVE.en)).toBe("Tue 6 Oct");
    expect(dayShort("2026-10-06", OBSERVE.ur)).toBe("منگل 6 اکتوبر");
    expect(lengthShort(38 * 60_000, OBSERVE.en)).toBe("38 min");
    expect(lengthShort(38 * 60_000, OBSERVE.ur)).toBe("38 منٹ");
    expect(lengthShort(20_000, OBSERVE.en)).toBe("Under 1 min");
    expect(observationLine("2026-10-06", 38 * 60_000, OBSERVE.en)).toBe("Tue 6 Oct · 38 min");
  });

  it("what is not known is left out, never made up", () => {
    expect(dayShort(null, OBSERVE.en)).toBe("");
    expect(lengthShort(null, OBSERVE.en)).toBe("");
    expect(lengthShort(0, OBSERVE.en)).toBe("");
    expect(observationLine(null, 38 * 60_000, OBSERVE.en)).toBe("38 min");
    expect(observationLine("2026-10-06", null, OBSERVE.en)).toBe("Tue 6 Oct");
  });

  it("each failure has its own real reason", () => {
    expect(failureWords("network", OBSERVE.en)).toMatch(/internet stopped.*safe on this phone/);
    expect(failureWords("plan_not_found", OBSERVE.en)).toMatch(/lesson plan could not be used/);
    expect(failureWords("not_your_teacher", OBSERVE.en)).toMatch(/not in your schools/);
    expect(failureWords("refused", OBSERVE.en)).toMatch(/not accepted/);
    expect(failureWords(null, OBSERVE.en)).toMatch(/not accepted/);
  });
});
