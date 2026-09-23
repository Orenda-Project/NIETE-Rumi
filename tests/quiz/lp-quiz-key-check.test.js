'use strict';
/**
 * An LP-born quiz never keys the lesson's own misconception as correct.
 *
 * Sandbox, Grade 3 Urdu واحد اور جمع (grade_3_urdu_ch5_seg5): the author turned
 * the misconception it was handed for distractor-seeding into the KEY. Item 7,
 * «اگر آپ کو 'بہار' کی جمع بنانی ہو تو کیا کریں گے؟», went out keyed to
 * «اس کی شکل نہیں بدلے گی» ("its form will not change") while the lesson says
 * بہار → بہاریں three times: in a vocabulary definition, in the We-Do check that
 * plants exactly this mistake, and in the homework answer. Nothing between the
 * author and the hand-off compared a key with the lesson.
 *
 * The fix is a KEY CHECK on lp_v8 quizzes, grounded in the slide script the
 * quiz was written from: one LLM call reads the lesson's own answers and its
 * planted mistakes and returns a verdict per item. A contradicting item is
 * re-authored once through the existing targeted rewrite (the conflict quoted as
 * its complaint) and re-checked; one that still contradicts is dropped when the
 * quiz keeps its floor, and otherwise the quiz fails with its own persisted
 * reason — never a silent send. A checker that errors does not cost the teacher
 * the quiz (fail-open, logged at error).
 *
 * Mocked at the boundary only: the LLM client (completeJson), supabase, WhatsApp,
 * the queue, R2, the PDF renderer and the share-code minter (a supabase writer).
 * The LP digest, the author, the validator, the targeted rewrite, the slide-script
 * store, generate and the hand-off all run for real.
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
// The render boundary: the PDF, and the PNG of a question card (the live item's
// options are longer than a reply button, so it is drawn as a card).
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
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const { logToFile } = require('../../bot/shared/utils/logger');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');
const { failureCopyKey } = require('../../bot/shared/services/quiz/quiz-sources');
const { installFrom } = require('./helpers/supabase-chain');
const F = require('./helpers/lp-key-check-fixture');
const Handoff = require('../../bot/shared/services/quiz/transcript-quiz-handoff.service');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
// The blind solve is not this suite's subject: an agreeing solver on its seam (see the helper).
const { installAgreeingSolver } = require('./helpers/key-verify-agree');

const QID = '77777777-7777-4777-8777-777777777777';
const LP_QUIZ = {
  id: QID, teacher_id: 'u-1', coaching_session_id: null, quiz_source: 'lp_v8', topic: 'واحد اور جمع',
  subject: 'urdu', language: 'ur', status: 'generating', grade: '3',
  meta: {
    step: 'digest', source: 'lp_offer', class: { grade: 3, subject: 'urdu' }, lesson_date: '2026-09-23',
    lessons: [{ lesson_id: F.LESSON_ID, asset_id: 'a-1', version_stamp: 'v8-20260920', content_hash: 'h-1', delivered_at: '2026-09-23T04:10:00Z' }],
  },
};
const TEACHER = { id: 'u-1', name: 'Rifat Noor', phone_number: '923001234567', preferred_language: 'ur' };

const verdictsFor = (indices, bad = {}) => ({
  verdicts: indices.map((index) => (bad[index]
    ? { index, verdict: 'contradicts', quote: bad[index] }
    : { index, verdict: 'consistent', quote: '' })),
});
/** The indices a checker prompt asks about, read off its "q<i>:" item headers. */
const askedIndices = (prompt) => [...String(prompt).matchAll(/^q(\d+): /gm)].map((m) => Number(m[1]));

/**
 * The LLM, routed by the label each pass already names itself with. `check` is
 * called once per key-check call with (prompt, n) and returns the reply json or
 * throws; `rewrite` likewise for the targeted rewrite.
 */
function llm({ check, rewrite } = {}) {
  let checks = 0;
  completeJson.mockImplementation(async ({ label, prompt }) => {
    if (label === 'lp_quiz.digest') return { json: F.MODEL_DIGEST, model: 'dm', costUsd: 0.001, latencyMs: 5 };
    if (label === 'transcript_quiz.author') {
      return { json: { lesson_summary: F.LESSON_SUMMARY, questions: F.AUTHORED }, model: 'am', costUsd: 0.01, latencyMs: 50 };
    }
    if (label === 'lp_quiz.key_check') {
      checks += 1;
      const json = await check(prompt, checks);
      return { json, model: 'cm', costUsd: 0.002, latencyMs: 20 };
    }
    if (label === 'transcript_quiz.rewrite') {
      if (!rewrite) throw new Error('no rewrite expected');
      return { json: await rewrite(prompt), model: 'rm', costUsd: 0.003, latencyMs: 30 };
    }
    throw new Error(`unexpected LLM call: ${label}`);
  });
}

function wire(quiz = LP_QUIZ) {
  installFrom(supabase.from, ({
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [quiz] }),
    coaching_sessions: () => { throw new Error('an lp_v8 quiz must never query coaching_sessions'); },
    niete_lp_asset_sources: {
      data: [{
        asset_id: 'a-1', lesson_id: F.LESSON_ID, version_stamp: 'v8-20260920', content_hash: 'h-1',
        slide_script: F.SLIDE_SCRIPT, source_url: null, verified: 'upload',
      }],
    },
    quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
    users: { data: [TEACHER] },
  }));
}

const quizUpdates = () => supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update').map((u) => u[1]);
const insertedRows = () => {
  const ins = supabase.from.callsFor('quiz_questions').flat().filter((c) => c[0] === 'insert');
  return ins.length ? ins[ins.length - 1][1] : null;
};
/** The option text a stored row marks correct. */
const keyedText = (row) => String(row[`option_${row.correct_option.toLowerCase()}`] || '').replace(/\u200f/g, '').trim();
const baharRow = (rows) => rows.find((r) => r.question_text.includes('بہار') && r.question_text.includes('جمع بنانی'));
const callsLabelled = (label) => completeJson.mock.calls.filter((c) => c[0].label === label);
const keyCheckEvent = () => {
  const ev = logEvent.mock.calls.filter((c) => c[0] === 'transcript_quiz.key_check');
  return ev.length ? ev[ev.length - 1][1] : null;
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
  installAgreeingSolver(Gen);
  jest.spyOn(Handoff, 'sleep').mockResolvedValue(undefined);
});

// ── the anchor: the live item ───────────────────────────────────────────────

describe('the live item — a key that says the lesson\'s own planted mistake', () => {
  test('the checker reads the lesson\'s three statements and the keyed option; the item is re-authored and never handed off with that key', async () => {
    llm({
      check: (prompt, n) => (n === 1
        ? verdictsFor(askedIndices(prompt), { 6: 'بہار سے بہاریں' })
        : verdictsFor(askedIndices(prompt))),
      rewrite: () => ({ questions: [F.REKEYED] }),
    });
    wire();

    const r = await Gen.process(QID, {});
    expect(r).toEqual(expect.objectContaining({ ok: true }));

    // What the children get: the item is there, keyed to what the lesson teaches.
    const rows = insertedRows();
    expect(rows).toHaveLength(8);
    expect(keyedText(baharRow(rows))).not.toBe(F.WRONG_KEY);
    expect(keyedText(baharRow(rows))).toContain('بہاریں');

    // The first check saw the lesson's own words — the fact, the planted
    // mistake, the homework answer — and the key it had to judge.
    const [first, recheck] = callsLabelled('lp_quiz.key_check').map((c) => c[0].prompt);
    expect(first).toContain(F.VOCAB_DEF);
    expect(first).toContain(F.PLANTED_CFU);
    expect(first).toContain(F.HOMEWORK_ANSWER);
    expect(first).toContain(F.WRONG_KEY);
    // The rewrite was told why, with the lesson's quote.
    const rwPrompt = callsLabelled('transcript_quiz.rewrite')[0][0].prompt;
    expect(rwPrompt).toMatch(/q6: KEY_CONFLICT/);
    expect(rwPrompt).toContain('بہار سے بہاریں');
    // …and only the rewritten item was checked again.
    expect(askedIndices(recheck)).toEqual([6]);

    const ready = quizUpdates().find((u) => u.status === 'ready');
    expect(ready.meta.key_check).toEqual(expect.objectContaining({
      status: 'fixed', checked: 8, contradicted: 1, fixed: 1, dropped: 0,
    }));
    expect(ready.meta.key_check.conflicts[0]).toEqual(expect.objectContaining({ index: 6, keyed: F.WRONG_KEY, outcome: 'fixed' }));
    expect(keyCheckEvent()).toEqual(expect.objectContaining({
      quizId: QID, quiz_source: 'lp_v8', status: 'fixed', checked: 8, contradicted: 1, fixed: 1, dropped: 0,
    }));
    expect(WhatsAppService.sendDocument).toHaveBeenCalledTimes(1);
  });

  test('a rewrite that still contradicts is dropped: seven questions go out, none of them keyed to the mistake', async () => {
    llm({
      check: (prompt) => verdictsFor(askedIndices(prompt), { 6: 'بہار سے بہاریں' }),
      rewrite: () => ({ questions: [F.REKEYED] }),
    });
    wire();

    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    const rows = insertedRows();
    expect(rows).toHaveLength(7);
    expect(baharRow(rows)).toBeUndefined();
    rows.forEach((row) => expect(keyedText(row)).not.toBe(F.WRONG_KEY));

    const ready = quizUpdates().find((u) => u.status === 'ready');
    expect(ready.meta.key_check).toEqual(expect.objectContaining({ status: 'dropped', contradicted: 1, fixed: 0, dropped: 1 }));
    expect(ready.meta.question_count).toBe(7);
  });

  test('when dropping would leave the quiz under its floor, the quiz FAILS as key_conflict — persisted, told, never sent', async () => {
    llm({
      check: (prompt) => verdictsFor(askedIndices(prompt), {
        1: 'کتاب سے کتابیں', 3: 'بستے', 6: 'بہار سے بہاریں',
      }),
      rewrite: () => ({ questions: [] }),   // the rewrite gives nothing usable
    });
    wire();

    const r = await Gen.process(QID, {});
    expect(r).toEqual(expect.objectContaining({ failed: true, reason: 'key_conflict' }));

    const failed = quizUpdates().find((u) => u.status === 'failed');
    expect(failed.meta.error).toBe('key_conflict');
    expect(failed.meta.key_check).toEqual(expect.objectContaining({ status: 'failed', contradicted: 3, dropped: 0 }));
    expect(insertedRows()).toBeNull();
    expect(WhatsAppService.sendDocument).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(TEACHER.phone_number, UX_STRINGS.tqFailedLpKeyConflict.ur);
    const ev = logEvent.mock.calls.find((c) => c[0] === 'transcript_quiz.failed');
    expect(ev[1]).toEqual(expect.objectContaining({ reason: 'key_conflict', quiz_source: 'lp_v8' }));
  });
});

// ── the ordinary cases ───────────────────────────────────────────────────────

describe('a quiz whose keys all agree with the lesson', () => {
  test('ships unchanged, for exactly ONE extra LLM call', async () => {
    llm({ check: (prompt) => verdictsFor(askedIndices(prompt)) });
    wire();

    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(callsLabelled('lp_quiz.key_check')).toHaveLength(1);
    expect(callsLabelled('transcript_quiz.rewrite')).toHaveLength(0);
    expect(askedIndices(callsLabelled('lp_quiz.key_check')[0][0].prompt)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

    const rows = insertedRows();
    expect(rows.map((row) => row.question_text.replace(/\u200f/g, '').trim()))
      .toEqual(F.AUTHORED.map((q) => q.question));
    const ready = quizUpdates().find((u) => u.status === 'ready');
    expect(ready.meta.key_check).toEqual(expect.objectContaining({
      status: 'clean', checked: 8, contradicted: 0, fixed: 0, dropped: 0, cost_usd: 0.002,
    }));
  });

  test('"unclear" does not block', async () => {
    llm({
      check: (prompt) => ({
        verdicts: askedIndices(prompt).map((index) => ({ index, verdict: index === 6 ? 'unclear' : 'consistent', quote: '' })),
      }),
    });
    wire();
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(insertedRows()).toHaveLength(8);
    expect(quizUpdates().find((u) => u.status === 'ready').meta.key_check).toEqual(expect.objectContaining({ status: 'clean', unclear: 1 }));
  });
});

describe('a checker that fails does not cost the teacher the quiz (fail-open)', () => {
  test.each([
    ['throws', () => { throw new Error('lp_quiz.key_check: timeout'); }],
    ['returns no verdicts', () => ({ questions: [] })],
  ])('the checker %s → the quiz still ships, the failure is logged at error and recorded', async (_, check) => {
    llm({ check });
    wire();

    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(insertedRows()).toHaveLength(8);
    expect(WhatsAppService.sendDocument).toHaveBeenCalledTimes(1);

    const errorLogs = logToFile.mock.calls.filter((c) => c[2] === 'error' && /key check/i.test(c[0]));
    expect(errorLogs).toHaveLength(1);
    const ready = quizUpdates().find((u) => u.status === 'ready');
    expect(ready.meta.key_check).toEqual(expect.objectContaining({ status: 'error' }));
    expect(keyCheckEvent()).toEqual(expect.objectContaining({ status: 'error', quiz_source: 'lp_v8' }));
  });
});

describe('the transcript path is untouched', () => {
  test('a transcript quiz is never key-checked (there is no written source to check against)', async () => {
    const DIGEST = { ...F.MODEL_DIGEST, topic_as_taught: 'واحد اور جمع' };
    const quiz = {
      id: QID, teacher_id: 'u-1', coaching_session_id: 's-1', quiz_source: 'transcript', topic: 'واحد اور جمع',
      subject: 'urdu', language: 'ur', status: 'generating', grade: '3', meta: { digest: DIGEST, grade: '3', step: 'author' },
    };
    llm({ check: () => { throw new Error('a transcript quiz must never be key-checked'); } });
    installFrom(supabase.from, ({
      quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [quiz] }),
      coaching_sessions: {
        data: [{
          id: 's-1', user_id: 'u-1', transcript_text: 'x'.repeat(3000), transcript_language: 'ur', created_at: '2026-09-23T05:00:00Z',
          analysis_data: {}, users: TEACHER,
        }],
      },
      quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
      users: { data: [TEACHER] },
    }));

    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(callsLabelled('lp_quiz.key_check')).toHaveLength(0);
    expect(quizUpdates().find((u) => u.status === 'ready').meta.key_check).toBeUndefined();
  });
});

// ── the pure parts ───────────────────────────────────────────────────────────

describe('SOURCE ANSWERS — the lesson\'s own facts, and separately its planted mistakes', () => {
  // Required per test, so a missing module fails each test by name rather than the suite.
  let KeyCheck;
  beforeEach(() => { KeyCheck = require('../../bot/shared/services/quiz/lp-quiz-key-check.service'); });

  test('facts carry the vocabulary definitions, key facts, worked/practice/exit answers and the homework answer', () => {
    const { facts } = KeyCheck.sourceAnswers(F.SLIDE_SCRIPT);
    const all = facts.join('\n');
    expect(all).toContain(F.VOCAB_DEF);
    expect(all).toContain(F.HOMEWORK_ANSWER);
    expect(all).toContain('گھڑیاں');                        // iDo worked answer
    expect(all).toContain('بستے');                          // weDo modelled + exit answer
    expect(all).toContain('کتابیں');                        // youDo answer
    expect(all).toContain('جمع بناتے وقت اکثر لفظ کا آخر بدل جاتا ہے۔');   // wrap key fact
    expect(all).toContain(F.SLIDE_SCRIPT.iDo.keyFact);
  });

  test('the planted mistakes are kept APART from the facts, and a check question is never a fact', () => {
    const { facts, mistakes, checks } = KeyCheck.sourceAnswers(F.SLIDE_SCRIPT);
    expect(mistakes.join('\n')).toContain(F.SLIDE_SCRIPT.iDo.misconception.slip);
    expect(checks.join('\n')).toContain(F.PLANTED_CFU);
    expect(facts.join('\n')).not.toContain(F.SLIDE_SCRIPT.iDo.misconception.slip);
    expect(facts.join('\n')).not.toContain(F.PLANTED_CFU);
  });

  test('a homework item may be a plain line or {prompt, answer}; both reach the facts', () => {
    const ss = { wrap: { homework: ['p.41 Q2: بہار کی جمع لکھیں (بہاریں)', { prompt: 'بستہ کی جمع', answer: 'بستے' }] } };
    const all = KeyCheck.sourceAnswers(ss).facts.join('\n');
    expect(all).toContain('بہاریں');
    expect(all).toContain('بستے');
  });

  test('an empty or unusable script has nothing to check against', () => {
    expect(KeyCheck.renderSourceBlock(KeyCheck.sourceAnswers(null))).toBe('');
    expect(KeyCheck.renderSourceBlock(KeyCheck.sourceAnswers({ meta: { grade: 3 } }))).toBe('');
  });

  test('a verdict the model mangles is "unclear", never a silent pass or a silent block', () => {
    const v = KeyCheck.parseVerdicts({ verdicts: [
      { index: 0, verdict: 'CONTRADICTS', quote: 'بہار سے بہاریں' },
      { index: 1, verdict: 'maybe' },
      { index: 9, verdict: 'contradicts' },
    ] }, [0, 1, 2], 'بہار سے بہاریں');
    expect(v).toEqual([
      expect.objectContaining({ index: 0, verdict: 'contradicts', grounded: true }),
      expect.objectContaining({ index: 1, verdict: 'unclear' }),
      expect.objectContaining({ index: 2, verdict: 'unclear', missing: true }),
    ]);
    expect(() => KeyCheck.parseVerdicts({ questions: [] }, [0], '')).toThrow(/verdicts/);
  });

  test('a quote is grounded through diacritics and punctuation; an invented one is not', () => {
    const source = KeyCheck.renderSourceBlock(KeyCheck.sourceAnswers(F.SLIDE_SCRIPT));
    const [withMarks, invented] = KeyCheck.parseVerdicts({ verdicts: [
      // a zabar on the first letter and a comma the lesson does not have
      { index: 0, verdict: 'contradicts', quote: 'ب\u064Eہار سے، بہاریں' },
      { index: 1, verdict: 'contradicts', quote: 'بہار کی جمع بہاروں ہوتی ہے' },
    ] }, [0, 1], source);
    expect(withMarks.grounded).toBe(true);
    expect(invented.grounded).toBe(false);
    // A contradiction without its evidence still counts — it is recorded as ungrounded, not dropped.
    expect(invented.verdict).toBe('contradicts');
  });
});

describe('the failure copy', () => {
  test('key_conflict has its own LP copy; a transcript quiz never reaches it', () => {
    expect(failureCopyKey('key_conflict', 'lp_v8')).toBe('tqFailedLpKeyConflict');
    expect(failureCopyKey('key_conflict', 'transcript')).toBe('tqCouldNotMake');
  });
});
