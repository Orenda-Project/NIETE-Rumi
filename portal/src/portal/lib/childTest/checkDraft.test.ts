import { describe, it, expect } from "vitest";
import { draftFrom, toCoachMarks, missingFields } from "./checkDraft";
import type { Prefill, ReadingCard, MathsCard } from "../../types/childTest";

// bd-s1oo0.7 — the check on the app is the WhatsApp check Flow as a web form:
// counts pre-filled, the words Rumi heard wrong as ticked chips, verdicts as
// radio buttons, and anything Rumi was not sure of arrives EMPTY for the coach.
// What is saved has the ai_marks shape (CONTRACT §5).

const urduCard: ReadingCard = {
  block: "urdu", grade: 3, form: "A", timedSeconds: 60, cue: { start: "x", stop: "y" },
  child: { story: { id: "s", title: null, text: "a b c" }, nonwords: [{ id: "nw1", text: "تامو" }], fallback: { letters: [], words: [] } },
  coach: { questions: [{ id: "q1", prompt: "Q1" }, { id: "q2", prompt: "Q2" }], firstSounds: [{ id: "fs1", word: "مچھلی" }] },
};

const prefill: Prefill = {
  version: "ai-marks-v1",
  story: { words_correct: 41, words_attempted: 45, seconds: 60, finished_early: false, confidence: 0.9,
    flagged: [{ idx: 3, word: "w3", verdict: "wrong", confidence: 0.8 }],
    uncertain: [{ idx: 9, word: "w9", verdict: "skipped", confidence: 0.3 }] },
  fallback: null,
  questions: [{ id: "q1", verdict: "correct", confidence: 0.9, hint: null }, { id: "q2", verdict: null, confidence: 0.4, hint: "wrong" }],
  first_sounds: [{ id: "fs1", verdict: null, hint: "correct", hint_only: true }],
  nonwords: [{ id: "nw1", verdict: "wrong", confidence: 0.8, hint: null }],
  protocol_flags: ["story_read_once"],
};

describe("draftFrom + toCoachMarks (reading)", () => {
  it("keeps the confident values and leaves the doubtful ones empty", () => {
    const d = draftFrom(prefill, urduCard);
    expect(d.wordsCorrect).toBe(41);
    expect(d.chips.map(({ idx, word, wrong, fromAi }) => ({ idx, word, wrong, fromAi }))).toEqual([
      { idx: 3, word: "w3", wrong: true, fromAi: "flagged" },
      { idx: 9, word: "w9", wrong: false, fromAi: "uncertain" },
    ]);
    expect(d.items.questions.map((q) => [q.id, q.label, q.verdict, q.hint])).toEqual([["q1", "Q1", "correct", null], ["q2", "Q2", null, "wrong"]]);
    expect(d.items.first_sounds[0]).toMatchObject({ label: "مچھلی", verdict: null, hint: "correct" });
    expect(missingFields(d)).toEqual(["questions.q2", "first_sounds.fs1"]);
  });

  it("builds ai_marks-shaped coach marks: flagged = the ticked chips, verdicts filled", () => {
    const d = draftFrom(prefill, urduCard);
    d.chips[0].wrong = false; // the child read w3 right
    d.chips[1].wrong = true;  // and w9 wrong
    d.wordsCorrect = 42;
    d.items.questions[1].verdict = "wrong";
    d.items.first_sounds[0].verdict = "correct";
    const m = toCoachMarks(d);
    expect(m.story).toMatchObject({ words_correct: 42, words_attempted: 45, seconds: 60 });
    // the AI's own entry is kept whole, so coach_edits shows only what the coach changed
    expect((m.story as { flagged: unknown[] }).flagged).toEqual([{ idx: 9, word: "w9", verdict: "skipped", confidence: 0.3 }]);
    expect(m.questions).toEqual([
      expect.objectContaining({ id: "q1", verdict: "correct" }), expect.objectContaining({ id: "q2", verdict: "wrong" }),
    ]);
    expect(m.protocol_flags).toEqual(["story_read_once"]);
    expect(JSON.stringify(m)).not.toMatch(/"hint"|"uncertain"|"label"|"fromAi"/);
    expect(missingFields(d)).toEqual([]);
  });

  it("with no AI marks (marking failed) it starts an empty form from the card", () => {
    const d = draftFrom(null, urduCard);
    expect(d.wordsCorrect).toBeNull();
    expect(d.items.questions.map((q) => q.id)).toEqual(["q1", "q2"]);
    expect(d.items.nonwords.map((q) => q.label)).toEqual(["تامو"]);
    expect(missingFields(d)).toEqual(["story.words_correct", "questions.q1", "questions.q2", "first_sounds.fs1", "nonwords.nw1"]);
  });
});

describe("maths", () => {
  const card: MathsCard = {
    block: "maths", grade: 3, form: "A", timedSeconds: 60, cue: { start: null, stop: null },
    child: { numbers: [6, 13], quickSums: ["3 + 1"], written: ["34 + 28", "56 + 27"] },
    coach: { numbersStopRule: null, numberIds: ["n1", "n2"], writtenIds: ["w1", "w2"], wordProblem: { id: "wp", prompt_ur: "u", prompt_en: "e" } },
  };
  const mp: Prefill = {
    version: "ai-marks-v1",
    maths: {
      numbers: [{ id: "n1", verdict: "correct", hint: null }, { id: "n2", verdict: null, hint: "wrong" }],
      quick_sums: { correct: 12, attempted: 14, seconds: 60 },
      written: [{ id: "w1", verdict: "correct", read_answer: "62", hint: null }, { id: "w2", verdict: null, read_answer: null, hint: "84" }],
      word_problem: { id: "wp", verdict: "wrong", read_answer: "7" },
    },
  };

  it("labels each item from the card and saves the maths shape", () => {
    const d = draftFrom(mp, card);
    expect(d.items.numbers.map((n) => n.label)).toEqual(["6", "13"]);
    expect(d.items.written.map((n) => [n.label, n.verdict, n.hint])).toEqual([["34 + 28", "correct", null], ["56 + 27", null, "84"]]);
    expect(d.quickSumsCorrect).toBe(12);
    expect(missingFields(d)).toEqual(["numbers.n2", "written.w2"]);
    d.items.numbers[1].verdict = "wrong";
    d.items.written[1].verdict = "wrong";
    const m = toCoachMarks(d) as { maths: { quick_sums: unknown; numbers: { verdict: string }[]; written: { id: string; verdict: string; read_answer: string | null }[]; word_problem: { verdict: string } } };
    expect(m.maths.quick_sums).toEqual({ correct: 12, attempted: 14, seconds: 60 });
    expect(m.maths.written[1]).toMatchObject({ id: "w2", verdict: "wrong" });
    expect(m.maths.word_problem.verdict).toBe("wrong");
  });
});

// bd-s1oo0.21 — CHILD_TEST_PREFILL_MODE=assist: a field Rumi filled below its bar carries `unsure`, and the
// form shows it as "Rumi unsure — please check". The flag is display-only: it is never saved back.
describe("assist: unsure fields", () => {
  const assist: Prefill = {
    ...prefill,
    story: { ...prefill.story!, unsure: true },
    questions: [{ id: "q1", verdict: "correct", confidence: 0.9, hint: null, unsure: false }, { id: "q2", verdict: "wrong", confidence: 0.4, hint: null, unsure: true }],
  };
  it("carries unsure onto the draft and keeps the filled value", () => {
    const d = draftFrom(assist, urduCard);
    expect(d.storyUnsure).toBe(true);
    expect(d.items.questions.map((q) => [q.id, q.verdict, q.unsure])).toEqual([["q1", "correct", false], ["q2", "wrong", true]]);
    expect(missingFields(d)).toEqual(["first_sounds.fs1"]);
  });
  it("never sends unsure back", () => {
    const d = draftFrom(assist, urduCard);
    d.items.first_sounds[0].verdict = "correct";
    expect(JSON.stringify(toCoachMarks(d))).not.toMatch(/"unsure"/);
  });
});
