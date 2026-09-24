'use strict';
/**
 * The teacher's sheet never presents a mistake made in class as what was
 * taught.
 *
 * The quiz PDF opens with "What you taught" (the author's lesson_summary_short,
 * else the first sentence of its lesson_summary) and "What this quiz checks",
 * and every question card carries the lesson's objective (the digest's SLO
 * statement). All of them are written from the recording. On staging, a Proper
 * Fraction lesson's summary said «آپ نے 3/3 اور 4/8 کی مثالیں دے کر کہا کہ یہ
 * Proper Fraction نہیں ہیں» — 4/8 IS a proper fraction — while the fixed quiz
 * under it keyed the opposite. Measured on the 136 production quizzes that
 * carried a wrong key: 27 printed the class's wrong fact as correct on the sheet.
 *
 * The operator's decision (option B): the sheet stops asserting it — no
 * correction note, nothing sent to anyone. Two layers, each tested here:
 *   1. the writers are told: every line to the teacher is true by the subject
 *      (the author's summary rule, the rewrite's summary rule, the digest's SLO
 *      rule);
 *   2. the guarantee: every teacher-facing line is checked by the verify model
 *      with NOTHING about the lesson — only the notes the blind solve made where
 *      it disagreed with a key, as hints; a false line is replaced by a rewrite
 *      that code accepts (same script, similar length, no blame word, no
 *      gendered teacher form) or else dropped. Fail-open.
 *
 * Mocked at the boundary only: the LLM (completeJson), supabase, WhatsApp, the
 * queue, R2, the PDF renderer and the share-code minter. The author, the
 * validator, the check, the blind solve, generate and the hand-off run for real.
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
  mintCode: jest.fn().mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'T' }),
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
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const { installFrom } = require('./helpers/supabase-chain');
const P = require('./helpers/proper-fraction-fixture');
const Handoff = require('../../bot/shared/services/quiz/transcript-quiz-handoff.service');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');

const QID = '7160be76-0000-4000-8000-000000000002';
const TEACHER = { id: 'u-1', name: 'T', phone_number: '923001234567', preferred_language: 'ur' };
const TRANSCRIPT = 'آج ہم نے fractions پڑھے۔ '.repeat(120);

// The staging lesson's mistake, in every place the sheet prints: the one-liner,
// the second sentence of the summary, and one objective in both languages.
const FALSE_SENTENCE = 'آپ نے 3/3 اور 4/8 کی مثالیں دے کر کہا کہ یہ Proper Fraction نہیں ہیں۔';
const TRUE_SENTENCE = 'آج آپ نے بچوں کو Proper Fraction پڑھایا اور بتایا کہ جس fraction میں numerator کی قیمت denominator سے کم ہو وہ Proper Fraction ہوتا ہے۔';
const SHORT_FALSE = 'آپ نے Proper Fraction پڑھایا اور بتایا کہ 4/8 Proper Fraction نہیں ہے۔';
const SLO_EN_FALSE = 'Recognise that 3/3 and 4/8 are not Proper Fractions';
const SLO_UR_FALSE = 'پہچان سکیں کہ 3/3 اور 4/8 Proper Fraction نہیں ہیں';
const CHECKS = 'یہ quiz جانچتا ہے کہ بچے Proper Fraction پہچان سکتے ہیں۔';

// What a careful teacher who knows the subject writes instead — the example
// named, the false verdict gone, nobody said to be wrong.
const REWRITE = new Map([
  [FALSE_SENTENCE, 'آپ نے 3/3 اور 4/8 جیسی مثالوں پر بات کی۔'],
  [SHORT_FALSE, 'آپ نے Proper Fraction پڑھایا اور 4/8 جیسی مثالوں پر بات کی۔'],
  [SLO_EN_FALSE, 'Identify Proper Fractions from given examples'],
  [SLO_UR_FALSE, 'دی گئی مثالوں سے Proper Fraction کی شناخت کر سکیں'],
]);
const isFalse = (text) => REWRITE.has(text);

const DIGEST = {
  ...P.DIGEST,
  slos: P.DIGEST.slos.map((s) => (s.id === 'S4'
    ? { ...s, statement: SLO_UR_FALSE, statement_en: SLO_EN_FALSE, statement_ur: SLO_UR_FALSE } : s)),
};
const QUIZ = {
  id: QID, teacher_id: 'u-1', coaching_session_id: 's-1', quiz_source: 'transcript', topic: 'Proper Fraction',
  subject: 'maths', language: 'ur', status: 'generating', grade: '3-5',
  meta: { digest: DIGEST, grade: '3-5', step: 'author' },
};

const clean = (s) => String(s || '').replace(/[\u200e\u200f]/g, '').replace(/\s+/g, ' ').trim();
/** The lines a summary-truth prompt asks about, read off its own list. */
const linesIn = (prompt) => [...String(prompt).matchAll(/^\[(L\d+)\] \([^)]*\) (.*)$/gm)].map((m) => ({ id: m[1], text: clean(m[2]) }));
/** A checker that knows the subject: 4/8 is a proper fraction. */
const subjectChecker = (rewriteOf = (t) => REWRITE.get(t)) => (prompt) => ({
  lines: linesIn(prompt).map(({ id, text }) => (isFalse(text)
    ? { id, false: true, claim: '4/8 is a proper fraction', rewrite: rewriteOf(text) }
    : { id, false: false, claim: '', rewrite: '' })),
});
/** Every blind solve agrees with the (fixed) keys — this suite is about the sheet, not the keys. */
const agreeAll = (prompt) => ({
  answers: [...String(prompt).matchAll(/^q(\d+) \(/gm)].map((m) => ({ index: Number(m[1]), correct: [], unsure: true, note: '' })),
});

function llm({
  truth = subjectChecker(), authored = null, bare = agreeAll, rewrite = () => ({ questions: [] }),
} = {}) {
  const questions = authored || P.AUTHORED.map((q, i) => (i === P.TARGET_INDEX ? P.TARGET_FIXED : q));
  completeJson.mockImplementation(async ({ label, prompt }) => {
    if (label === 'transcript_quiz.author') {
      return {
        json: {
          lesson_summary: `${TRUE_SENTENCE} ${FALSE_SENTENCE}`, lesson_summary_short: SHORT_FALSE, checks_summary: CHECKS, questions,
        },
        model: 'am', costUsd: 0.01, latencyMs: 50,
      };
    }
    if (label === 'transcript_quiz.summary_truth') {
      const json = await truth(prompt);
      if (json instanceof Error) throw json;
      return { json, model: 'vm', costUsd: 0.002, latencyMs: 20 };
    }
    if (label === 'transcript_quiz.key_verify') return { json: agreeAll(prompt), model: 'vm', costUsd: 0.004, latencyMs: 40 };
    if (label === 'transcript_quiz.key_verify_bare') return { json: bare(prompt), model: 'vm', costUsd: 0.004, latencyMs: 40 };
    if (label === 'transcript_quiz.rewrite') return { json: rewrite(prompt), model: 'rm', costUsd: 0.003, latencyMs: 30 };
    if (label === 'transcript_quiz.add_pictures') return { json: { questions: [] }, model: 'pm', costUsd: 0.001, latencyMs: 10 };
    throw new Error(`unexpected LLM call: ${label}`);
  });
}

function wire(quiz = QUIZ) {
  installFrom(supabase.from, ({
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [quiz] }),
    coaching_sessions: {
      data: [{
        id: 's-1', user_id: 'u-1', transcript_text: TRANSCRIPT, transcript_language: 'ur',
        created_at: '2026-09-24T05:00:00Z', analysis_data: {}, users: TEACHER,
      }],
    },
    quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
    users: { data: [TEACHER] },
  }));
}

const quizUpdates = () => supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update').map((u) => u[1]);
const readyMeta = () => (quizUpdates().find((u) => u.status === 'ready') || {}).meta;
const prompts = (label) => completeJson.mock.calls.filter((c) => c[0].label === label).map((c) => c[0].prompt);
/** Everything the sheet can print about the lesson, from what was stored. */
function sheetTexts(meta) {
  const d = meta.digest || {};
  return [meta.lesson_summary_short, meta.lesson_summary, d.checks_summary,
    ...(d.slos || []).flatMap((s) => [s.statement, s.statement_en, s.statement_ur])].filter(Boolean).map(clean);
}
const assertsTheMistake = (t) => /4\/8/.test(t) && /(نہیں ہیں|نہیں ہے|are not|is not)/.test(t);

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
  jest.spyOn(Handoff, 'sleep').mockResolvedValue(undefined);
});

// ── layer 2: the guarantee, through generate ────────────────────────────────

describe('through generate: nothing the sheet prints presents the class\'s mistake as taught', () => {
  test('the one-liner, the summary sentence and the objective are rewritten; the rest is untouched', async () => {
    llm();
    wire();

    const r = await Gen.process(QID, {});
    expect(r).toEqual(expect.objectContaining({ ok: true }));

    const meta = readyMeta();
    expect(sheetTexts(meta).filter(assertsTheMistake)).toEqual([]);
    expect(clean(meta.lesson_summary_short)).toBe(REWRITE.get(SHORT_FALSE));
    expect(clean(meta.lesson_summary)).toBe(`${TRUE_SENTENCE} ${REWRITE.get(FALSE_SENTENCE)}`);
    const s4 = meta.digest.slos.find((s) => s.id === 'S4');
    expect(s4.statement_en).toBe(REWRITE.get(SLO_EN_FALSE));
    expect(s4.statement_ur).toBe(REWRITE.get(SLO_UR_FALSE));
    expect(s4.statement).toBe(REWRITE.get(SLO_UR_FALSE));
    // A line that was true stays exactly as authored.
    expect(meta.digest.slos.find((s) => s.id === 'S1')).toEqual(P.DIGEST.slos.find((s) => s.id === 'S1'));
    expect(clean(meta.digest.checks_summary)).toBe(CHECKS);
    // Recorded, with counts in the event (never the text).
    expect(meta.summary_truth).toEqual(expect.objectContaining({ status: 'fixed', rewritten: 4, dropped: 0 }));
    const ev = logEvent.mock.calls.find((c) => c[0] === 'transcript_quiz.summary_truth');
    expect(ev[1]).toEqual(expect.objectContaining({ quizId: QID, status: 'fixed', rewritten: 4 }));
    expect(JSON.stringify(ev[1])).not.toMatch(/4\/8/);
  });

  test('the check is told NOTHING about the lesson — only the lines, the subject and the grade', async () => {
    llm();
    wire();
    await Gen.process(QID, {});

    const [p] = prompts('transcript_quiz.summary_truth');
    expect(p).toBeTruthy();
    expect(p).not.toContain('آج ہم نے fractions پڑھے');          // no transcript
    expect(p).not.toContain(clean(P.TARGET_FIXED.question));      // no question
    expect(p).not.toContain('misconceptions');                   // no digest
    expect(linesIn(p).map((l) => l.text)).toEqual(expect.arrayContaining([SHORT_FALSE, FALSE_SENTENCE, SLO_EN_FALSE, SLO_UR_FALSE, CHECKS]));
  });

  test('what the blind solve found reaches the check as a hint — the solver\'s note, never the question', async () => {
    const NOTE = 'a fraction shows parts of a whole';
    let bares = 0;
    llm({
      // the first solve without the lesson finds no right answer on q0 and says
      // why; the targeted rewrite replaces q0 and the re-solve is unsure (never blocks)
      bare: (prompt) => {
        bares += 1;
        return {
          answers: [...String(prompt).matchAll(/^q(\d+) \(/gm)].map((m) => (Number(m[1]) === 0 && bares === 1
            ? { index: 0, correct: [], unsure: false, note: NOTE }
            : { index: Number(m[1]), correct: [], unsure: true, note: '' })),
        };
      },
      rewrite: () => ({ questions: [{ ...P.AUTHORED[0], index: 0, question: 'ان میں سے fraction کیا ہوتا ہے؟' }] }),
    });
    wire();
    const r = await Gen.process(QID, {});
    expect(r).toEqual(expect.objectContaining({ ok: true }));

    const [p] = prompts('transcript_quiz.summary_truth');
    expect(p).toMatch(/WHAT THE QUIZ'S OWN ANSWER CHECK FOUND/);
    expect(p).toContain(`- ${NOTE}`);
    expect(p).not.toContain(clean(P.AUTHORED[0].question));
    expect(readyMeta().summary_truth).toEqual(expect.objectContaining({ hints: 1 }));
  });

  test('with nothing found by the blind solve, the check gets no hint section', async () => {
    llm();
    wire();
    await Gen.process(QID, {});
    const [p] = prompts('transcript_quiz.summary_truth');
    expect(p).not.toMatch(/ANSWER CHECK FOUND/);
    expect(readyMeta().summary_truth).toEqual(expect.objectContaining({ hints: 0 }));
  });

  test('a rewrite that would tell the teacher they were wrong is refused: the line is dropped, never a correction note', async () => {
    llm({
      truth: subjectChecker((t) => (t === FALSE_SENTENCE
        ? 'آپ نے 4/8 کو غلط طور پر Proper Fraction نہیں کہا، دراصل یہ Proper Fraction ہے۔'
        : REWRITE.get(t))),
    });
    wire();
    await Gen.process(QID, {});

    const meta = readyMeta();
    expect(clean(meta.lesson_summary)).toBe(TRUE_SENTENCE);
    expect(sheetTexts(meta).join(' ')).not.toMatch(/غلط|دراصل/);
    expect(meta.summary_truth).toEqual(expect.objectContaining({ rewritten: 3, dropped: 1 }));
    expect(meta.summary_truth.lines).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'summary', action: 'dropped', why: 'blame_word' })]));
  });

  test('a rewrite in the wrong script, or one that genders the teacher, is refused too', async () => {
    llm({
      truth: subjectChecker((t) => {
        if (t === SHORT_FALSE) return 'You taught Proper Fractions with 4/8 as an example.';        // Urdu line → English
        if (t === FALSE_SENTENCE) return 'استانی نے 3/3 اور 4/8 جیسی مثالیں دکھائیں۔';              // استانی: a gendered noun
        return REWRITE.get(t);
      }),
    });
    wire();
    await Gen.process(QID, {});

    const meta = readyMeta();
    expect(sheetTexts(meta).filter(assertsTheMistake)).toEqual([]);
    expect(meta.lesson_summary_short).toBeUndefined();        // dropped: the sheet falls back to the summary's first sentence
    expect(clean(meta.lesson_summary)).toBe(TRUE_SENTENCE);
    const why = meta.summary_truth.lines.filter((l) => l.action === 'dropped').map((l) => l.why).sort();
    expect(why).toEqual(['gendered', 'script_changed']);
  });

  test('a check that fails costs nothing: the quiz ships as authored, recorded, logged at error', async () => {
    llm({ truth: () => new Error('provider 502') });
    wire();

    const r = await Gen.process(QID, {});
    expect(r).toEqual(expect.objectContaining({ ok: true }));
    const meta = readyMeta();
    expect(meta.summary_truth).toEqual(expect.objectContaining({ status: 'error' }));
    expect(clean(meta.lesson_summary_short)).toBe(SHORT_FALSE);
    expect(logToFile.mock.calls.filter((c) => c[2] === 'error' && /summary truth/i.test(c[0]))).toHaveLength(1);
  });

  test('a reply with no "lines" is a failed check, never "all true"', async () => {
    llm({ truth: () => ({ verdicts: [] }) });
    wire();
    await Gen.process(QID, {});
    expect(readyMeta().summary_truth).toEqual(expect.objectContaining({ status: 'error' }));
  });

  test('a quiz whose sheet says nothing false ships its lines exactly as authored', async () => {
    llm({ truth: (prompt) => ({ lines: linesIn(prompt).map(({ id }) => ({ id, false: false })) }) });
    wire({ ...QUIZ, meta: { ...QUIZ.meta, digest: P.DIGEST } });
    await Gen.process(QID, {});
    const meta = readyMeta();
    expect(meta.summary_truth).toEqual(expect.objectContaining({ status: 'clean', rewritten: 0, dropped: 0 }));
    expect(clean(meta.lesson_summary_short)).toBe(SHORT_FALSE);   // the checker said it was fine; nothing is second-guessed in code
    expect(meta.digest.slos).toEqual(P.DIGEST.slos);
  });
});

describe('a summary never goes to the sheet empty', () => {
  test('every sentence false and no rewrite taken: the checked one-liner stands in', async () => {
    llm({ truth: (prompt) => ({ lines: linesIn(prompt).map(({ id, text }) => (text === TRUE_SENTENCE || text === FALSE_SENTENCE
      ? { id, false: true, claim: 'x', rewrite: '' } : { id, false: isFalse(text), claim: 'x', rewrite: REWRITE.get(text) || '' })) }) });
    wire();
    await Gen.process(QID, {});
    const meta = readyMeta();
    expect(clean(meta.lesson_summary)).toBe(REWRITE.get(SHORT_FALSE));
    expect(meta.summary_truth).toEqual(expect.objectContaining({ fallback: 'short' }));
  });

  test('…and with no one-liner left either, a line that names only the topic', async () => {
    llm({ truth: (prompt) => ({ lines: linesIn(prompt).map(({ id, text }) => (text === TRUE_SENTENCE || text === FALSE_SENTENCE || text === SHORT_FALSE
      ? { id, false: true, claim: 'x', rewrite: '' } : { id, false: false })) }) });
    wire();
    await Gen.process(QID, {});
    const meta = readyMeta();
    expect(meta.lesson_summary_short).toBeUndefined();
    expect(clean(meta.lesson_summary)).toBe(clean(UX_STRINGS.tqSummaryTopicOnly.ur.replace('{topic}', 'Proper Fraction')));
    expect(meta.summary_truth).toEqual(expect.objectContaining({ fallback: 'topic' }));
  });

  test('the topic line exists in both languages, asserts nothing, and names nobody', () => {
    const { addressForms } = require('../../bot/shared/services/quiz/transcript-quiz-address');
    const { genderedTeacherForms } = require('../../bot/shared/services/quiz/transcript-quiz-pedagogy');
    for (const lang of ['en', 'ur']) {
      const s = UX_STRINGS.tqSummaryTopicOnly[lang];
      expect(s).toContain('{topic}');
      expect(genderedTeacherForms(s, lang)).toEqual([]);
      expect(addressForms(s, { kind: 'explanation' })).toEqual([]);
      expect(s).not.toMatch(/\b(she|her|he|his|him)\b/i);
      // long enough for the validator's summary floor with any topic
      expect([...s.replace('{topic}', 'x')].length).toBeGreaterThanOrEqual(20);
    }
  });
});

describe('the check, on its own', () => {
  const Truth = require('../../bot/shared/services/quiz/transcript-quiz-summary-truth');

  test('every summary sentence is its own line, so one false sentence can go without the rest', () => {
    const lines = Truth.collectLines({ lessonSummary: `${TRUE_SENTENCE} ${FALSE_SENTENCE}`, extras: {}, slos: [] });
    expect(lines.map((l) => l.text)).toEqual([TRUE_SENTENCE, FALSE_SENTENCE]);
  });

  test('an objective written the same in two fields is checked once and fixed in both', () => {
    const lines = Truth.collectLines({ lessonSummary: '', extras: {}, slos: DIGEST.slos });
    const s4 = lines.filter((l) => l.text === SLO_UR_FALSE);
    expect(s4).toHaveLength(1);
    expect(s4[0].targets.map((t) => t.key).sort()).toEqual(['statement', 'statement_ur']);
  });

  test.each([
    ['empty', ''],
    ['unchanged', FALSE_SENTENCE],
    ['too_long', `${REWRITE.get(FALSE_SENTENCE)} ${'اور بہت کچھ '.repeat(20)}`],
    ['script_changed', 'You discussed examples like 3/3 and 4/8.'],
    ['blame_word', 'آپ نے 4/8 کو غلطی سے Proper Fraction نہیں کہا۔'],
  ])('a rewrite that is %s is refused', (why, rewrite) => {
    expect(Truth.rewriteRefusal(FALSE_SENTENCE, rewrite)).toBe(why);
  });

  test('a word the line already had is not "blame" (an objective about the correct article)', () => {
    expect(Truth.rewriteRefusal('Choose the correct article, a or an, before a word', 'Choose the correct article before a word')).toBeNull();
  });
});

// ── layer 1: what the writers are told ──────────────────────────────────────

describe('the writers are told that a line to the teacher is true by the subject', () => {
  const { SUMMARY_TRUTH_RULE } = require('../../bot/shared/services/quiz/transcript-quiz-contract');
  const flat = (s) => String(s).replace(/\s+/g, ' ');

  test('the rule exists, names the class\'s mistake, and forbids a correction note', () => {
    expect(typeof SUMMARY_TRUTH_RULE).toBe('string');
    expect(SUMMARY_TRUTH_RULE).toMatch(/TRUE BY THE SUBJECT/);
    expect(SUMMARY_TRUTH_RULE).toMatch(/4\/8/);
    expect(SUMMARY_TRUTH_RULE).toMatch(/never say or imply that the teacher or the class was wrong/i);
  });

  test('the author prompt for a recording carries it; the lesson-plan prompt is unchanged', () => {
    const Author = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
    const rec = Author.buildAuthorPrompt({ digest: P.DIGEST, excerpts: 'x', language: 'ur', n: 8, gradeBand: '3-5' });
    expect(flat(rec)).toContain(flat(SUMMARY_TRUTH_RULE));
    const lp = Author.buildAuthorPrompt({ digest: P.DIGEST, excerpts: '', language: 'ur', n: 8, gradeBand: '3-5', lessonPlan: 'plan' });
    expect(flat(lp)).not.toContain(flat(SUMMARY_TRUTH_RULE));
  });

  test('the targeted rewrite of a recording\'s summary carries it', () => {
    const { buildRewritePrompt } = require('../../bot/shared/services/quiz/transcript-quiz-rewrite');
    const p = buildRewritePrompt({
      digest: P.DIGEST, language: 'ur', questions: P.AUTHORED, targets: { indices: [], byIndex: {}, summary: ['AUTHOR_MISSING_SUMMARY'] }, lessonSummary: FALSE_SENTENCE,
    });
    expect(flat(p)).toContain(flat(SUMMARY_TRUTH_RULE));
  });

  test('the digest prompt says an objective is the correct one, never the mistake', () => {
    const { buildDigestPrompt } = require('../../bot/shared/services/quiz/transcript-quiz-digest.service');
    const p = flat(buildDigestPrompt({ transcript: 'x', transcriptLanguage: 'ur' }));
    expect(p).toMatch(/TRUE BY THE SUBJECT/);
    expect(p).toMatch(/an SLO statement is the correct objective/i);
    expect(p).toMatch(/never say the teacher was wrong/i);
  });
});

// ── the kill switch: QUIZ_SUMMARY_TRUTH_FILTER ──────────────────────────────

describe('QUIZ_SUMMARY_TRUTH_FILTER turns all of it off, read at call time', () => {
  const { summaryTruthEnabled, SUMMARY_TRUTH_RULE } = require('../../bot/shared/services/quiz/transcript-quiz-contract');
  const flat = (x) => String(x).replace(/\s+/g, ' ');
  afterEach(() => { delete process.env.QUIZ_SUMMARY_TRUTH_FILTER; });

  test.each([
    [undefined, true], ['', true], ['true', true], ['1', true], ['on', true],
    ['false', false], ['0', false], ['off', false], ['no', false], [' OFF ', false], ['False', false],
  ])('QUIZ_SUMMARY_TRUTH_FILTER=%p → on: %p', (value, on) => {
    if (value === undefined) delete process.env.QUIZ_SUMMARY_TRUTH_FILTER; else process.env.QUIZ_SUMMARY_TRUTH_FILTER = value;
    expect(summaryTruthEnabled()).toBe(on);
  });

  test('off: no check runs, and the sheet ships exactly as authored', async () => {
    process.env.QUIZ_SUMMARY_TRUTH_FILTER = 'off';
    llm();
    wire();

    const r = await Gen.process(QID, {});
    expect(r).toEqual(expect.objectContaining({ ok: true }));
    expect(prompts('transcript_quiz.summary_truth')).toEqual([]);
    const meta = readyMeta();
    expect(meta.summary_truth).toBeUndefined();
    expect(clean(meta.lesson_summary_short)).toBe(SHORT_FALSE);
    expect(clean(meta.lesson_summary)).toBe(`${TRUE_SENTENCE} ${FALSE_SENTENCE}`);
    expect(meta.digest.slos.find((s) => s.id === 'S4').statement_en).toBe(SLO_EN_FALSE);
    // …and the author was never given the rule
    expect(flat(prompts('transcript_quiz.author')[0] || '')).not.toContain(flat(SUMMARY_TRUTH_RULE));
    expect(logEvent.mock.calls.find((c) => c[0] === 'transcript_quiz.summary_truth')).toBeUndefined();
  });

  test('read per job: the same process turns it off, then back on, with no reload', async () => {
    process.env.QUIZ_SUMMARY_TRUTH_FILTER = 'false';
    llm(); wire();
    await Gen.process(QID, {});
    expect(prompts('transcript_quiz.summary_truth')).toHaveLength(0);

    delete process.env.QUIZ_SUMMARY_TRUTH_FILTER;
    jest.clearAllMocks();
    llm(); wire();
    await Gen.process(QID, {});
    expect(prompts('transcript_quiz.summary_truth')).toHaveLength(1);
  });

  test('off: the digest, author and rewrite prompts carry no truth rule at all', () => {
    process.env.QUIZ_SUMMARY_TRUTH_FILTER = 'off';
    const { buildDigestPrompt } = require('../../bot/shared/services/quiz/transcript-quiz-digest.service');
    const Author = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
    const { buildRewritePrompt } = require('../../bot/shared/services/quiz/transcript-quiz-rewrite');
    expect(flat(buildDigestPrompt({ transcript: 'x', transcriptLanguage: 'ur' }))).not.toMatch(/TRUE BY THE SUBJECT/);
    expect(flat(Author.buildAuthorPrompt({ digest: P.DIGEST, excerpts: 'x', language: 'ur', n: 8, gradeBand: '3-5' }))).not.toContain(flat(SUMMARY_TRUTH_RULE));
    expect(flat(buildRewritePrompt({
      digest: P.DIGEST, language: 'ur', questions: P.AUTHORED, targets: { indices: [], byIndex: {}, summary: ['AUTHOR_MISSING_SUMMARY'] }, lessonSummary: 'x',
    }))).not.toContain(flat(SUMMARY_TRUTH_RULE));
  });
});
