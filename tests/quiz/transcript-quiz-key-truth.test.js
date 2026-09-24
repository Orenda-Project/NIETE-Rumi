'use strict';
/**
 * A key is right by the SUBJECT, never by what was said in class.
 *
 * Staging, a transcript quiz on Proper Fraction: «ان میں سے کون سا Proper
 * Fraction نہیں ہے؟ 1/4 · 4/8 · 2/5» went out keyed 4/8. All three are proper
 * fractions. The item's own explanation says so, then sides with the class:
 * «… 4، 8 سے چھوٹا ہے، لیکن استاد نے کلاس میں 4/8 کو Proper Fraction نہیں مانا
 * تھا». The blind solve, which is shown the lesson summary as context, agreed —
 * the summary repeated the class's mistake — and the quiz shipped "clean". A
 * wrong key marks every child who knows the fact wrong, and the class report
 * then teaches the mistake back to the teacher.
 *
 * Two layers, each tested on its own:
 *   1. the explanation that concedes the fact and sides with the class is a
 *      validator fault (KEY_BY_AUTHORITY), repaired by the targeted rewrite or
 *      else dropped — it never ships;
 *   2. the blind solve checks every item a second time WITHOUT the lesson, so a
 *      summary that repeats a mistake cannot talk it into agreeing: an item the
 *      subject alone decides differently is a disagreement.
 *
 * Mocked at the boundary only: the LLM client (completeJson), supabase,
 * WhatsApp, the queue, R2, the PDF renderer and the share-code minter. The
 * author, the validator, the targeted rewrite, the blind solve, generate and
 * the hand-off all run for real.
 */

jest.mock('../../bot/shared/services/quiz/transcript-quiz-llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  mintCode: jest.fn().mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'Rifat Noor' }),
  botNumber: jest.fn().mockReturnValue('923000000000'),
}));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({
  htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')),
  htmlToImage: jest.fn().mockResolvedValue(Buffer.from('png-bytes')),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn().mockResolvedValue('https://r2/x'), downloadFromR2: jest.fn(),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { completeJson } = require('../../bot/shared/services/quiz/transcript-quiz-llm');
const supabase = require('../../bot/shared/config/supabase');
const { logToFile } = require('../../bot/shared/utils/logger');
const { installFrom } = require('./helpers/supabase-chain');
const P = require('./helpers/proper-fraction-fixture');
const Handoff = require('../../bot/shared/services/quiz/transcript-quiz-handoff.service');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');

const QID = '7160be76-0000-4000-8000-000000000001';
const TEACHER = { id: 'u-1', name: 'Rifat Noor', phone_number: '923001234567', preferred_language: 'ur' };
const QUIZ = {
  id: QID, teacher_id: 'u-1', coaching_session_id: 's-1', quiz_source: 'transcript', topic: 'Proper Fraction',
  subject: 'maths', language: 'ur', status: 'generating', grade: '3-5',
  meta: { digest: P.DIGEST, grade: '3-5', step: 'author' },
};
const CTX = { language: 'ur', subject: 'maths', digest: P.DIGEST, nExpected: 8, lessonSummary: P.LESSON_SUMMARY, quizId: QID };

const clean = (s) => String(s || '').replace(/[\u200e\u200f]/g, '').replace(/\s+/g, ' ').trim();

/** The items a solver prompt asks about, read off its own item blocks. */
function itemsIn(prompt) {
  const out = new Map();
  for (const m of String(prompt).matchAll(/^q(\d+) \([^)\n]*\): (.*)\n\s+options: (.*)$/gm)) {
    const options = m[3].split(' | ').map((s) => clean(s.replace(/^\[\d+\]\s*/, '')));
    out.set(Number(m[1]), { stem: clean(m[2]), options });
  }
  return out;
}

const KEYED = new Map([...P.AUTHORED, P.TARGET_FIXED].map((q) => [clean(q.question) + clean(q.options.join('|')), clean(q.options[q.correct_index])]));
const frac = (o) => { const m = /\\frac\{(\d+)\}\{(\d+)\}/.exec(o); return m ? [Number(m[1]), Number(m[2])] : null; };

/** What is TRUE by the subject: a proper fraction has the smaller number on top. */
function bySubject(item) {
  if (/Proper Fraction نہیں ہے/.test(item.stem)) return item.options.filter((o) => { const f = frac(o); return f && f[0] >= f[1]; });
  if (/Proper Fraction ہے/.test(item.stem)) return item.options.filter((o) => { const f = frac(o); return f && f[0] < f[1]; });
  return [KEYED.get(item.stem + item.options.slice().sort().join('|'))
    || KEYED.get([...KEYED.keys()].find((k) => k.startsWith(item.stem)))].filter(Boolean);
}
/** What the staging solver did with the lesson summary in front of it: it followed the class. */
function asTheLessonSaid(item) {
  if (item.stem === clean(P.TARGET_STEM) && item.options.includes(clean(P.TARGET_KEY))) return [clean(P.TARGET_KEY)];
  return bySubject(item);
}
/** A solver answering every asked item by `rule`, by the positions it was SHOWN. */
const solver = (rule) => (prompt) => ({
  answers: [...itemsIn(prompt)].map(([index, item]) => {
    const right = rule(item);
    return { index, correct: item.options.map((o, k) => (right.includes(o) ? k : -1)).filter((k) => k >= 0), unsure: false, note: right.length ? '' : 'all three are proper fractions' };
  }),
});

/** An in-place repair keeps the item's meaning — here, the class's mistake with it. */
const TARGET_REWORDED = {
  index: P.TARGET_INDEX,
  ...P.AUTHORED[P.TARGET_INDEX],
  explanation: '‏Proper Fraction میں numerator کی قیمت denominator سے کم ہوتی ہے۔ $\\frac{4}{8}$ میں 4، 8 سے چھوٹا ہے، لیکن استاد نے کلاس میں 4/8 کو Proper Fraction نہیں مانا تھا۔',
};

function llm({ authored = P.AUTHORED, verify = solver(asTheLessonSaid), bare = solver(bySubject), rewrite } = {}) {
  let bares = 0;
  completeJson.mockImplementation(async ({ label, prompt }) => {
    if (label === 'transcript_quiz.author') {
      return { json: { lesson_summary: P.LESSON_SUMMARY, questions: authored }, model: 'am', costUsd: 0.01, latencyMs: 50 };
    }
    if (label === 'transcript_quiz.key_verify') return { json: await verify(prompt), model: 'vm', costUsd: 0.004, latencyMs: 40 };
    if (label === 'transcript_quiz.key_verify_bare') {
      bares += 1;
      return { json: await bare(prompt, bares), model: 'vm', costUsd: 0.004, latencyMs: 40 };
    }
    if (label === 'transcript_quiz.rewrite') {
      const json = rewrite ? await rewrite(prompt)
        : { questions: [/KEY_(BY_AUTHORITY|NONE_CORRECT|DISAGREEMENT)/.test(prompt) ? P.TARGET_FIXED : TARGET_REWORDED] };
      return { json, model: 'rm', costUsd: 0.003, latencyMs: 30 };
    }
    if (label === 'transcript_quiz.add_pictures') return { json: { questions: [] }, model: 'pm', costUsd: 0.001, latencyMs: 10 };
    throw new Error(`unexpected LLM call: ${label}`);
  });
}

function wire() {
  installFrom(supabase.from, ({
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [QUIZ] }),
    coaching_sessions: {
      data: [{
        id: 's-1', user_id: 'u-1', transcript_text: 'آج ہم نے fractions پڑھے۔ '.repeat(120), transcript_language: 'ur',
        created_at: '2026-09-24T05:00:00Z', analysis_data: {}, users: TEACHER,
      }],
    },
    quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
    users: { data: [TEACHER] },
  }));
}

const quizUpdates = () => supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update').map((u) => u[1]);
const readyUpdate = () => quizUpdates().find((u) => u.status === 'ready');
const insertedRows = () => {
  const ins = supabase.from.callsFor('quiz_questions').flat().filter((c) => c[0] === 'insert');
  return ins.length ? ins[ins.length - 1][1] : null;
};
const keyedTexts = (row) => row.correct_option.split(',').map((l) => clean(row[`option_${l.trim().toLowerCase()}`]));
const optionTexts = (row) => ['a', 'b', 'c', 'd'].map((l) => row[`option_${l}`]).filter((o) => o != null).map(clean);
const liveRow = (rows) => rows.find((r) => clean(r.question_text) === clean(P.TARGET_STEM));
const prompts = (label) => completeJson.mock.calls.filter((c) => c[0].label === label).map((c) => c[0].prompt);
/** Never ships: the live question with the live options, keyed 4/8. */
const shipsTheWrongKey = (rows) => rows.some((r) => clean(r.question_text) === clean(P.TARGET_STEM)
  && optionTexts(r).sort().join('|') === P.TARGET_OPTIONS.map(clean).sort().join('|') && keyedTexts(r).includes(clean(P.TARGET_KEY)));

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
  jest.spyOn(Handoff, 'sleep').mockResolvedValue(undefined);
});

// ── layer 1: the explanation that sides with the class against the fact ─────

describe('an explanation that concedes the fact and sides with the class', () => {
  test('the live item is a KEY_BY_AUTHORITY fault, named on its own question', () => {
    const v = validate(P.AUTHORED, CTX);
    const fault = v.errors.filter((e) => /KEY_BY_AUTHORITY/.test(e));
    expect(fault).toEqual([expect.stringMatching(/^q6: KEY_BY_AUTHORITY — /)]);
    // The complaint quotes the sentence, so the rewrite reads what went wrong.
    expect(fault[0]).toContain('نہیں مانا');
  });

  test.each([
    ['an Urdu explanation that credits the class with the fact', '‏fraction میں اوپر والے نمبر کو numerator کہتے ہیں، جیسا کہ کلاس میں بتایا گیا تھا۔'],
    ['an English one that credits the teacher', 'Homophones sound the same but have different meanings, as the teacher explained.'],
    ['a contrast inside the fact itself', 'The teacher explained that melting ice is a physical change, but it is still water.'],
  ])('%s is not a fault', (_, explanation) => {
    const qs = P.AUTHORED.map((q, i) => (i === P.TARGET_INDEX ? P.TARGET_FIXED : (i === 0 ? { ...q, explanation } : q)));
    const v = validate(qs, CTX);
    expect(v.errors.filter((e) => /KEY_BY_AUTHORITY/.test(e))).toEqual([]);
  });

  test('through generate: the live item is rewritten from the fault, and 4/8 is never the key', async () => {
    llm();
    wire();

    const r = await Gen.process(QID, {});
    expect(r).toEqual(expect.objectContaining({ ok: true }));

    const rows = insertedRows();
    expect(shipsTheWrongKey(rows)).toBe(false);
    expect(keyedTexts(liveRow(rows))).toEqual([clean('$\\frac{5}{3}$')]);
    // The rewrite was told why, and was given the rule.
    const rw = prompts('transcript_quiz.rewrite')[0];
    expect(rw).toMatch(/q6: KEY_BY_AUTHORITY/);
    expect(rw).toContain('KEY BY AUTHORITY.');
  });

  test('a rewrite that keeps the class\'s answer is dropped, never shipped', async () => {
    llm({ rewrite: () => ({ questions: [TARGET_REWORDED] }) });
    wire();

    const r = await Gen.process(QID, {});
    expect(r).toEqual(expect.objectContaining({ ok: true }));
    const rows = insertedRows();
    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(shipsTheWrongKey(rows)).toBe(false);
  });
});

// ── layer 2: the blind solve, with the lesson and without it ────────────────

describe('the blind solve decides a fact without the lesson as well', () => {
  const SILENT = P.AUTHORED.map((q, i) => (i === P.TARGET_INDEX ? P.TARGET_SILENT : q));

  test('the lesson summary repeats the class\'s mistake; the second solve, without it, catches the key', async () => {
    llm({ authored: SILENT });
    wire();

    const r = await Gen.process(QID, {});
    expect(r).toEqual(expect.objectContaining({ ok: true }));
    const rows = insertedRows();
    expect(shipsTheWrongKey(rows)).toBe(false);

    // One solve with the lesson, one without it — and the one without never sees it.
    const [withLesson] = prompts('transcript_quiz.key_verify');
    const [bare] = prompts('transcript_quiz.key_verify_bare');
    expect(withLesson).toContain(clean(P.LESSON_SUMMARY).slice(0, 40));
    expect(bare).toBeDefined();
    expect(bare).not.toContain(clean(P.LESSON_SUMMARY).slice(0, 40));
    expect(bare).not.toMatch(/Lesson summary|What the children were meant to learn/);
    expect([...itemsIn(bare).keys()]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

    // The rewrite was told the subject found no option right, and that it was solved without the lesson.
    const rw = prompts('transcript_quiz.rewrite').find((p) => /KEY_NONE_CORRECT/.test(p));
    expect(rw).toMatch(/q6: KEY_NONE_CORRECT — .*without the lesson/);

    const kv = readyUpdate().meta.key_verify;
    expect(kv).toEqual(expect.objectContaining({ status: 'fixed', none_correct: 1, fixed: 1 }));
    expect(kv.disagreements).toEqual([expect.objectContaining({ index: 6, verdict: 'none_correct', pass: 'bare', outcome: 'fixed' })]);
    expect(kv.bare).toEqual(expect.objectContaining({ checked: 8, flagged: 1 }));
  });

  test('an item only the lesson can answer is "unsure" without it, and never blocks', async () => {
    llm({
      authored: P.AUTHORED.map((q, i) => (i === P.TARGET_INDEX ? P.TARGET_FIXED : q)),
      bare: (prompt) => {
        const json = solver(bySubject)(prompt);
        json.answers.forEach((a) => { if (a.index === 0) { a.unsure = true; a.correct = []; } });
        return json;
      },
    });
    wire();

    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(insertedRows()).toHaveLength(8);
    expect(prompts('transcript_quiz.rewrite')).toHaveLength(0);
    expect(readyUpdate().meta.key_verify).toEqual(expect.objectContaining({
      status: 'clean', agreed: 8, bare: expect.objectContaining({ checked: 8, flagged: 0, unclear: 1 }),
    }));
  });

  // Replayed on 631 production items: most first answers of "another option is
  // right" without the lesson were a slip between an option's position and its
  // text, and a second look in another order did not repeat them.
  const NUMERATOR = 1;   // «اوپر والے نمبر 2 کو کیا کہتے ہیں؟» — numerator
  const slipOn = (index, answer) => (prompt) => {
    const json = solver(bySubject)(prompt);
    const item = itemsIn(prompt).get(index);
    json.answers.forEach((a) => { if (a.index === index) a.correct = [item.options.indexOf(answer)]; });
    return json;
  };
  const FIXED_SET = P.AUTHORED.map((q, i) => (i === P.TARGET_INDEX ? P.TARGET_FIXED : q));

  test('"another option is right" without the lesson counts only if a second look, in another order, says it too', async () => {
    llm({
      authored: FIXED_SET,
      bare: (prompt, n) => (n === 1 ? slipOn(NUMERATOR, 'denominator') : solver(bySubject))(prompt),
    });
    wire();

    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(insertedRows()).toHaveLength(8);
    expect(prompts('transcript_quiz.rewrite')).toHaveLength(0);
    const [first, again] = prompts('transcript_quiz.key_verify_bare');
    expect([...itemsIn(again).keys()]).toEqual([NUMERATOR]);
    expect(itemsIn(again).get(NUMERATOR).options).not.toEqual(itemsIn(first).get(NUMERATOR).options);
    expect(readyUpdate().meta.key_verify).toEqual(expect.objectContaining({
      status: 'clean', disagreed: 0, bare: expect.objectContaining({ second_look: 1, confirmed: 0, flagged: 0 }),
    }));
  });

  test('…and when the second look says it too, it is a disagreement like any other', async () => {
    llm({
      authored: FIXED_SET,
      bare: (prompt) => slipOn(NUMERATOR, 'denominator')(prompt),
      rewrite: () => ({ questions: [{ index: NUMERATOR, ...P.AUTHORED[NUMERATOR] }] }),
    });
    wire();

    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    const rw = prompts('transcript_quiz.rewrite')[0];
    expect(rw).toMatch(new RegExp(`q${NUMERATOR}: KEY_DISAGREEMENT — .*without the lesson`));
    const kv = readyUpdate().meta.key_verify;
    expect(kv.disagreements).toEqual([expect.objectContaining({ index: NUMERATOR, verdict: 'disagree', pass: 'bare' })]);
    expect(kv.bare).toEqual(expect.objectContaining({ second_look: 1, confirmed: 1, flagged: 1 }));
  });

  test('a solve without the lesson that fails costs nothing: the quiz ships, the failure is logged at error', async () => {
    llm({
      authored: P.AUTHORED.map((q, i) => (i === P.TARGET_INDEX ? P.TARGET_FIXED : q)),
      bare: () => { throw new Error('transcript_quiz.key_verify_bare: timeout'); },
    });
    wire();

    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(insertedRows()).toHaveLength(8);
    const kv = readyUpdate().meta.key_verify;
    expect(kv).toEqual(expect.objectContaining({ status: 'clean', bare: expect.objectContaining({ status: 'error' }) }));
    expect(logToFile.mock.calls.filter((c) => c[2] === 'error' && /without the lesson/i.test(c[0]))).toHaveLength(1);
  });
});
