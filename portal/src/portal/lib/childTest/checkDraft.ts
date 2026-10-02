/**
 * bd-s1oo0.7 — the check form's state, built from the bot's prefill.
 *
 * The prefill (app-api.service buildCheckPrefill — the same rule as the
 * WhatsApp check Flow) already holds back anything Rumi was not sure of: such a
 * verdict is null with the model's guess as a `hint`, and doubtful story words
 * are `uncertain` chips, unticked. The coach fills the gaps and corrects the
 * rest. toCoachMarks gives back the ai_marks shape (CONTRACT §5), keeping each
 * AI entry's other fields untouched, so the bot's diff (coach_edits) lists only
 * what the coach actually changed.
 */

import type { ChildTestCard, Prefill, PrefillItem } from "../../types/childTest";

type Obj = Record<string, unknown>;

export type DraftItem = { id: string; label: string; verdict: string | null; hint: string | null; unsure: boolean; orig: Obj };
export type Chip = { idx: number; word: string; wrong: boolean; fromAi: "flagged" | "uncertain"; orig?: Obj };

export type Draft = {
  block: ChildTestCard["block"];
  base: Prefill | null;
  wordsCorrect: number | null;
  /** assist: the count / letters+words / quick sums were filled below their bar ("Rumi unsure — please check") */
  storyUnsure: boolean;
  fallbackUnsure: boolean;
  quickSumsUnsure: boolean;
  chips: Chip[];
  fallback: { letters: number | null; words: number | null } | null;
  quickSumsCorrect: number | null;
  items: { questions: DraftItem[]; first_sounds: DraftItem[]; nonwords: DraftItem[]; numbers: DraftItem[]; written: DraftItem[] };
  wordProblem: DraftItem | null;
};

function strip(o: Obj, keys: string[]): Obj {
  const out: Obj = {};
  for (const [k, v] of Object.entries(o)) if (!keys.includes(k)) out[k] = v;
  return out;
}

function items(ids: { id: string; label: string }[], from: PrefillItem[] | undefined): DraftItem[] {
  const byId = new Map((from || []).map((x) => [x.id, x]));
  return ids.map(({ id, label }) => {
    const p = byId.get(id);
    return { id, label, verdict: (p?.verdict as string | null) ?? null, hint: p?.hint ?? null, unsure: Boolean(p?.unsure), orig: p ? strip(p as Obj, ["hint", "unsure"]) : { id } };
  });
}

export function draftFrom(prefill: Prefill | null, card: ChildTestCard): Draft {
  const empty = { questions: [], first_sounds: [], nonwords: [], numbers: [], written: [] } as Draft["items"];
  if (card.block === "maths") {
    const m = prefill?.maths;
    const numbers = card.coach.numberIds.map((id, i) => ({ id, label: String(card.child.numbers[i] ?? "") }));
    const written = card.coach.writtenIds.map((id, i) => ({ id, label: card.child.written[i] ?? "" }));
    const wp = card.coach.wordProblem;
    return {
      block: "maths",
      base: prefill,
      wordsCorrect: null,
      storyUnsure: false,
      fallbackUnsure: false,
      quickSumsUnsure: Boolean(m?.quick_sums?.unsure),
      chips: [],
      fallback: null,
      quickSumsCorrect: m?.quick_sums && typeof m.quick_sums.correct === "number" ? m.quick_sums.correct : null,
      items: { ...empty, numbers: items(numbers, m?.numbers), written: items(written, m?.written) },
      wordProblem: wp ? items([{ id: wp.id, label: wp.prompt_ur }], m?.word_problem ? [m.word_problem] : [])[0] : null,
    };
  }
  const s = prefill?.story;
  const chips: Chip[] = [
    ...(s?.flagged || []).map((f) => ({ idx: f.idx, word: f.word, wrong: true, fromAi: "flagged" as const, orig: f as Obj })),
    ...(s?.uncertain || []).map((f) => ({ idx: f.idx, word: f.word, wrong: false, fromAi: "uncertain" as const, orig: f as Obj })),
  ];
  const fb = prefill?.fallback;
  return {
    block: card.block,
    base: prefill,
    wordsCorrect: s && typeof s.words_correct === "number" ? s.words_correct : null,
    storyUnsure: Boolean(s?.unsure),
    fallbackUnsure: Boolean(fb?.unsure),
    quickSumsUnsure: false,
    chips,
    fallback: fb ? { letters: fb.letters?.correct ?? null, words: fb.words?.correct ?? null } : null,
    quickSumsCorrect: null,
    items: {
      ...empty,
      questions: items(card.coach.questions.map((q) => ({ id: q.id, label: q.prompt })), prefill?.questions),
      first_sounds: items(card.coach.firstSounds.map((f) => ({ id: f.id, label: f.word })), prefill?.first_sounds),
      nonwords: items(card.child.nonwords.map((n) => ({ id: n.id, label: n.text })), prefill?.nonwords),
    },
    wordProblem: null,
  };
}

/** Every field still empty, as "<section>.<id>" — the form will not save until this is []. */
export function missingFields(d: Draft): string[] {
  const out: string[] = [];
  const need = (section: string, list: DraftItem[]) => list.forEach((i) => { if (!i.verdict) out.push(`${section}.${i.id}`); });
  if (d.block === "maths") {
    need("numbers", d.items.numbers);
    if (d.quickSumsCorrect == null) out.push("quick_sums.correct");
    need("written", d.items.written);
    if (d.wordProblem && !d.wordProblem.verdict) out.push("word_problem");
    return out;
  }
  if (d.fallback) {
    if (d.fallback.letters == null) out.push("fallback.letters");
    if (d.fallback.words == null) out.push("fallback.words");
  } else if (d.wordsCorrect == null) {
    out.push("story.words_correct");
  }
  need("questions", d.items.questions);
  need("first_sounds", d.items.first_sounds);
  need("nonwords", d.items.nonwords);
  return out;
}

function verdicts(list: DraftItem[]) {
  return list.map((i) => ({ ...i.orig, id: i.id, verdict: i.verdict }));
}

export function toCoachMarks(d: Draft): Obj {
  const base = (d.base || {}) as Prefill;
  const out: Obj = { version: base.version || "ai-marks-v1" };
  if (d.block === "maths") {
    const m = (base.maths || {}) as NonNullable<Prefill["maths"]>;
    out.maths = {
      ...m,
      numbers: verdicts(d.items.numbers),
      quick_sums: { ...strip((m.quick_sums || { attempted: null, seconds: 60 }) as Obj, ["unsure"]), correct: d.quickSumsCorrect },
      written: verdicts(d.items.written),
      word_problem: d.wordProblem ? { ...d.wordProblem.orig, id: d.wordProblem.id, verdict: d.wordProblem.verdict } : (m.word_problem ?? null),
    };
  } else {
    const s = (base.story || {}) as Obj;
    out.story = {
      ...strip(s, ["uncertain", "unsure"]),
      words_correct: d.wordsCorrect,
      flagged: d.chips.filter((c) => c.wrong).map((c) => c.orig || { idx: c.idx, word: c.word, verdict: "wrong" }),
    };
    out.fallback = d.fallback
      ? { letters: { correct: d.fallback.letters, of: 10 }, words: { correct: d.fallback.words, of: 10 } }
      : (base.fallback ?? null);
    out.questions = verdicts(d.items.questions);
    out.first_sounds = verdicts(d.items.first_sounds);
    out.nonwords = verdicts(d.items.nonwords);
  }
  if (base.protocol_flags) out.protocol_flags = base.protocol_flags;
  return out;
}
