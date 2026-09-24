'use strict';
/**
 * A quiz never ships an answer key that a blind solver disagrees with.
 *
 * Sandbox, a transcript quiz on a letters lesson (حروف کا جوڑ توڑ): «لفظ حال کے
 * جوڑ توڑ میں کون سے حروف شامل ہیں؟» went out keyed «ہ، ا، ل» — حال is spelled
 * ح ا ل — and «سلام» went out with two options holding the same four letters,
 * i.e. two right answers. The class report then told the teacher the wrong
 * spelling was right and planned tomorrow's drill on it. The lp_v8 key check
 * cannot catch this (a spelling is in no lesson source) and the transcript path
 * had no check at all.
 *
 * The fix is a BLIND SOLVE on both paths, after authoring and validation (and
 * after the lp key check) and before any row is stored: one LLM call sees each
 * item's question and options WITHOUT the key and says which options are
 * correct. An item it answers differently, or finds two (or no) correct options
 * in, is re-authored once through the existing targeted rewrite and re-solved;
 * what still disagrees is dropped when the quiz keeps its floor, else the quiz
 * fails as `key_disagreement`, persisted and told. A solver that fails costs the
 * teacher nothing (fail-open, logged at error).
 *
 * Mocked at the boundary only: the LLM client (completeJson), supabase, WhatsApp,
 * the queue, R2, the PDF renderer and the share-code minter. The author, the
 * validator, the targeted rewrite, the LP digest, the key check, generate and
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
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const { logToFile } = require('../../bot/shared/utils/logger');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');
const { failureCopyKey } = require('../../bot/shared/services/quiz/quiz-sources');
const { installFrom } = require('./helpers/supabase-chain');
const F = require('./helpers/key-verify-fixture');
const LP = require('./helpers/lp-key-check-fixture');
const Handoff = require('../../bot/shared/services/quiz/transcript-quiz-handoff.service');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');

const QID = '33c92e31-0000-4000-8000-000000000001';
const TEACHER = { id: 'u-1', name: 'Rifat Noor', phone_number: '923001234567', preferred_language: 'ur' };
const TRANSCRIPT_QUIZ = {
  id: QID, teacher_id: 'u-1', coaching_session_id: 's-1', quiz_source: 'transcript', topic: 'حروف کا جوڑ توڑ',
  subject: 'urdu', language: 'ur', status: 'generating', grade: '3',
  meta: { digest: F.DIGEST, grade: '3', step: 'author' },
};
const LP_QUIZ = {
  id: QID, teacher_id: 'u-1', coaching_session_id: null, quiz_source: 'lp_v8', topic: 'واحد اور جمع',
  subject: 'urdu', language: 'ur', status: 'generating', grade: '3',
  meta: {
    step: 'digest', source: 'lp_offer', class: { grade: 3, subject: 'urdu' }, lesson_date: '2026-09-23',
    lessons: [{ lesson_id: LP.LESSON_ID, asset_id: 'a-1', version_stamp: 'v8-20260920', content_hash: 'h-1', delivered_at: '2026-09-23T04:10:00Z' }],
  },
};

const clean = (s) => String(s || '').replace(/\u200f/g, '').trim();

/**
 * The items a solver prompt asks about, read off its own item blocks:
 * `q<i> (…): <stem>` then `options: [0] … | [1] … | [2] …`.
 */
function itemsIn(prompt) {
  const out = new Map();
  for (const m of String(prompt).matchAll(/^q(\d+) \([^)\n]*\): (.*)\n\s+options: (.*)$/gm)) {
    const options = m[3].split(' | ').map((s) => clean(s.replace(/^\[\d+\]\s*/, '')));
    out.set(Number(m[1]), { stem: clean(m[2]), options });
  }
  return out;
}

/** What is actually true, by stem: the texts of every correct option. */
function truthFrom(questions, overrides = {}) {
  const t = new Map(questions.map((q) => [clean(q.question), [clean(q.options[q.correct_index])]]));
  Object.entries(overrides).forEach(([stem, texts]) => t.set(clean(stem), texts.map(clean)));
  return t;
}

/** A solver that answers every asked item from `truth` (texts), by the positions it was SHOWN. */
function solverFor(truth) {
  return (prompt) => ({
    answers: [...itemsIn(prompt)].map(([index, item]) => {
      const right = truth.get(item.stem) || [];
      return { index, correct: item.options.map((o, k) => (right.includes(o) ? k : -1)).filter((k) => k >= 0), unsure: false, note: '' };
    }),
  });
}

const TRUTH = truthFrom(F.AUTHORED, {
  [F.HAAL_STEM]: [F.HAAL_RIGHT],
  [F.SALAAM_STEM]: [F.SALAAM_KEY, F.SALAAM_TWIN],
});

/** The second solve, without the lesson, when a test is not about it: unsure of everything, so it changes no verdict. */
const unsureOfEverything = (prompt) => ({
  answers: [...itemsIn(prompt).keys()].map((index) => ({ index, correct: [], unsure: true, note: '' })),
});

/**
 * The LLM, routed by the label each pass names itself with. `verify` answers
 * every blind-solve call with (prompt, n); `bare` the solve without the lesson
 * (transcript-quiz-key-truth.test.js drives that one); `rewrite` the targeted rewrite.
 */
function llm({ verify, rewrite, check, bare = unsureOfEverything } = {}) {
  let verifies = 0;
  let bares = 0;
  let checks = 0;
  completeJson.mockImplementation(async ({ label, prompt }) => {
    if (label === 'lp_quiz.digest') return { json: LP.MODEL_DIGEST, model: 'dm', costUsd: 0.001, latencyMs: 5 };
    if (label === 'transcript_quiz.author') {
      const lp = /واحد|جمع/.test(prompt) && !/جوڑ توڑ/.test(prompt);
      return lp
        ? { json: { lesson_summary: LP.LESSON_SUMMARY, questions: LP.AUTHORED }, model: 'am', costUsd: 0.01, latencyMs: 50 }
        : { json: { lesson_summary: F.LESSON_SUMMARY, questions: F.AUTHORED }, model: 'am', costUsd: 0.01, latencyMs: 50 };
    }
    if (label === 'lp_quiz.key_check') {
      checks += 1;
      const json = check ? await check(prompt, checks)
        : { verdicts: [...String(prompt).matchAll(/^q(\d+): /gm)].map((m) => ({ index: Number(m[1]), verdict: 'consistent', quote: '' })) };
      return { json, model: 'cm', costUsd: 0.002, latencyMs: 20 };
    }
    if (label === 'transcript_quiz.key_verify') {
      verifies += 1;
      const json = await verify(prompt, verifies);
      return { json, model: 'vm', costUsd: 0.004, latencyMs: 40 };
    }
    if (label === 'transcript_quiz.key_verify_bare') {
      bares += 1;
      return { json: await bare(prompt, bares), model: 'vm', costUsd: 0.004, latencyMs: 40 };
    }
    if (label === 'transcript_quiz.rewrite') {
      if (!rewrite) throw new Error('no rewrite expected');
      return { json: await rewrite(prompt), model: 'rm', costUsd: 0.003, latencyMs: 30 };
    }
    throw new Error(`unexpected LLM call: ${label}`);
  });
}

function wireTranscript(quiz = TRANSCRIPT_QUIZ) {
  installFrom(supabase.from, ({
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [quiz] }),
    coaching_sessions: {
      data: [{
        id: 's-1', user_id: 'u-1', transcript_text: 'آج ہم نے حروف کا جوڑ توڑ کیا۔ '.repeat(120), transcript_language: 'ur',
        created_at: '2026-09-23T05:00:00Z', analysis_data: {}, users: TEACHER,
      }],
    },
    quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
    users: { data: [TEACHER] },
  }));
}

function wireLp(quiz = LP_QUIZ) {
  installFrom(supabase.from, ({
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [quiz] }),
    coaching_sessions: () => { throw new Error('an lp_v8 quiz must never query coaching_sessions'); },
    niete_lp_asset_sources: {
      data: [{
        asset_id: 'a-1', lesson_id: LP.LESSON_ID, version_stamp: 'v8-20260920', content_hash: 'h-1',
        slide_script: LP.SLIDE_SCRIPT, source_url: null, verified: 'upload',
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
/** The option texts a stored row marks correct. */
const keyedTexts = (row) => row.correct_option.split(',').map((l) => clean(row[`option_${l.trim().toLowerCase()}`]));
const optionTexts = (row) => ['a', 'b', 'c', 'd'].map((l) => row[`option_${l}`]).filter((o) => o != null).map(clean);
const rowFor = (rows, stem) => rows.find((r) => clean(r.question_text) === clean(stem));
const callsLabelled = (label) => completeJson.mock.calls.filter((c) => c[0].label === label);
const verifyEvent = () => {
  const ev = logEvent.mock.calls.filter((c) => c[0] === 'transcript_quiz.key_verify');
  return ev.length ? ev[ev.length - 1][1] : null;
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
  jest.spyOn(Handoff, 'sleep').mockResolvedValue(undefined);
});

// ── the anchor: the live items ──────────────────────────────────────────────

describe('the live transcript quiz — «حال» keyed to a misspelling, «سلام» with two right answers', () => {
  test('both items are re-authored from the solver\'s disagreement and neither ships as it was', async () => {
    llm({
      verify: (prompt, n) => solverFor(n === 1 ? TRUTH : truthFrom([F.HAAL_REKEYED, F.SALAAM_REWRITTEN]))(prompt),
      rewrite: () => ({ questions: [F.SALAAM_REWRITTEN, F.HAAL_REKEYED] }),
    });
    wireTranscript();

    const r = await Gen.process(QID, {});
    expect(r).toEqual(expect.objectContaining({ ok: true }));

    const rows = insertedRows();
    expect(rows).toHaveLength(8);
    // حال: keyed to the right spelling now.
    expect(keyedTexts(rowFor(rows, F.HAAL_STEM))).toEqual([F.HAAL_RIGHT]);
    // سلام: one right answer — the twin is gone.
    const salaam = rowFor(rows, F.SALAAM_STEM);
    expect(keyedTexts(salaam)).toEqual([F.SALAAM_KEY]);
    expect(optionTexts(salaam)).not.toContain(F.SALAAM_TWIN);

    // The solver never saw a key: no index, no explanation, no feedback.
    const [first, resolve] = callsLabelled('transcript_quiz.key_verify').map((c) => c[0].prompt);
    expect(first).not.toMatch(/correct_index|marked correct|explanation|option_feedback|selected_because/i);
    expect(first).not.toContain('درست جواب');
    expect(first).not.toContain('بالکل درست');
    expect([...itemsIn(first).keys()]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(itemsIn(first).get(6).options.sort()).toEqual([F.HAAL_WRONG_KEY, F.HAAL_RIGHT, 'ح، ل، م'].sort());
    // The rewrite was told why; only the two rewritten items were solved again.
    const rwPrompt = callsLabelled('transcript_quiz.rewrite')[0][0].prompt;
    expect(rwPrompt).toMatch(/q6: KEY_DISAGREEMENT/);
    expect(rwPrompt).toMatch(/q3: KEY_AMBIGUOUS/);
    expect(rwPrompt).toContain(F.HAAL_RIGHT);
    expect(rwPrompt).toContain('KEY CHECK.');                 // the rule for this complaint rides along
    expect([...itemsIn(resolve).keys()]).toEqual([3, 6]);

    const kv = readyUpdate().meta.key_verify;
    expect(kv).toEqual(expect.objectContaining({
      status: 'fixed', checked: 8, agreed: 6, disagreed: 1, ambiguous: 1, none_correct: 0, fixed: 2, dropped: 0,
    }));
    expect(kv.disagreements).toEqual(expect.arrayContaining([
      expect.objectContaining({ index: 6, verdict: 'disagree', keyed: F.HAAL_WRONG_KEY, blind: F.HAAL_RIGHT, outcome: 'fixed' }),
      expect.objectContaining({ index: 3, verdict: 'ambiguous', keyed: F.SALAAM_KEY, outcome: 'fixed' }),
    ]));
    expect(verifyEvent()).toEqual(expect.objectContaining({
      quizId: QID, quiz_source: 'transcript', status: 'fixed', checked: 8, disagreed: 1, ambiguous: 1, fixed: 2, dropped: 0,
    }));
    expect(WhatsAppService.sendDocument).toHaveBeenCalledTimes(1);
  });

  test('a rewrite the solver still disagrees with is dropped: the quiz goes out without the wrong key', async () => {
    llm({
      verify: solverFor(TRUTH),                            // every solve says the same
      rewrite: () => ({ questions: [] }),                   // the rewrite gives nothing usable
    });
    wireTranscript();

    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    const rows = insertedRows();
    expect(rows).toHaveLength(6);
    expect(rowFor(rows, F.HAAL_STEM)).toBeUndefined();
    expect(rowFor(rows, F.SALAAM_STEM)).toBeUndefined();
    rows.forEach((row) => expect(keyedTexts(row)).not.toContain(F.HAAL_WRONG_KEY));

    const ready = readyUpdate();
    expect(ready.meta.key_verify).toEqual(expect.objectContaining({ status: 'dropped', fixed: 0, dropped: 2 }));
    expect(ready.meta.question_count).toBe(6);
  });

  test('only the «حال» key is wrong → only that item is rewritten; the rest ship untouched', async () => {
    llm({
      verify: (prompt, n) => solverFor(n === 1
        ? truthFrom(F.AUTHORED, { [F.HAAL_STEM]: [F.HAAL_RIGHT] })
        : truthFrom([F.HAAL_REKEYED]))(prompt),
      rewrite: () => ({ questions: [F.HAAL_REKEYED] }),
    });
    wireTranscript();

    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    const rows = insertedRows();
    expect(rows).toHaveLength(8);
    expect(keyedTexts(rowFor(rows, F.HAAL_STEM))).toEqual([F.HAAL_RIGHT]);
    F.AUTHORED.filter((q) => q.question !== F.HAAL_STEM).forEach((q) => {
      expect(keyedTexts(rowFor(rows, q.question))).toEqual([clean(q.options[q.correct_index])]);
    });
    expect(readyUpdate().meta.key_verify).toEqual(expect.objectContaining({ status: 'fixed', disagreed: 1, ambiguous: 0, fixed: 1 }));
  });
});

// ── the ordinary cases ───────────────────────────────────────────────────────

describe('a quiz whose keys a blind solver agrees with', () => {
  test('ships unchanged, for exactly TWO extra LLM calls — the solve with the lesson and the one without', async () => {
    const agree = truthFrom(F.AUTHORED);
    llm({ verify: solverFor(agree) });
    wireTranscript();

    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(callsLabelled('transcript_quiz.key_verify')).toHaveLength(1);
    expect(callsLabelled('transcript_quiz.key_verify_bare')).toHaveLength(1);
    expect(callsLabelled('transcript_quiz.rewrite')).toHaveLength(0);

    const rows = insertedRows();
    expect(rows.map((row) => clean(row.question_text))).toEqual(F.AUTHORED.map((q) => clean(q.question)));
    rows.forEach((row, i) => expect(keyedTexts(row)).toEqual([clean(F.AUTHORED[i].options[0])]));
    expect(readyUpdate().meta.key_verify).toEqual(expect.objectContaining({
      status: 'clean', checked: 8, agreed: 8, disagreed: 0, ambiguous: 0, fixed: 0, dropped: 0, cost_usd: 0.008, model: 'vm',
      bare: expect.objectContaining({ status: 'ok', checked: 8, flagged: 0 }),
    }));
  });

  test('"unsure" never blocks', async () => {
    llm({
      verify: (prompt) => {
        const json = solverFor(TRUTH)(prompt);
        json.answers.forEach((a) => { if (a.index === 6 || a.index === 3) { a.unsure = true; } });
        return json;
      },
    });
    wireTranscript();
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(insertedRows()).toHaveLength(8);
    expect(callsLabelled('transcript_quiz.rewrite')).toHaveLength(0);
    expect(readyUpdate().meta.key_verify).toEqual(expect.objectContaining({ status: 'clean', unclear: 2 }));
  });
});

describe('a solver that fails does not cost the teacher the quiz (fail-open)', () => {
  test.each([
    ['throws', () => { throw new Error('transcript_quiz.key_verify: timeout'); }],
    ['returns no answers', () => ({ questions: [] })],
  ])('the solver %s → the quiz ships as authored, the failure is logged at error and recorded', async (_, verify) => {
    llm({ verify });
    wireTranscript();

    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(insertedRows()).toHaveLength(8);
    expect(WhatsAppService.sendDocument).toHaveBeenCalledTimes(1);

    const errorLogs = logToFile.mock.calls.filter((c) => c[2] === 'error' && /key verify/i.test(c[0]));
    expect(errorLogs).toHaveLength(1);
    expect(readyUpdate().meta.key_verify).toEqual(expect.objectContaining({ status: 'error' }));
    expect(verifyEvent()).toEqual(expect.objectContaining({ status: 'error', quiz_source: 'transcript' }));
  });
});

describe('when dropping would leave the quiz under its floor', () => {
  test('the quiz FAILS as key_disagreement — persisted, told in its own words, never sent', async () => {
    const wrongThree = truthFrom(F.AUTHORED, {
      [F.HAAL_STEM]: [F.HAAL_RIGHT],
      [F.SALAAM_STEM]: [F.SALAAM_KEY, F.SALAAM_TWIN],
      [F.AUTHORED[1].question]: ['م'],
    });
    llm({ verify: solverFor(wrongThree), rewrite: () => ({ questions: [] }) });
    wireTranscript();

    const r = await Gen.process(QID, {});
    expect(r).toEqual(expect.objectContaining({ failed: true, reason: 'key_disagreement' }));

    const failed = quizUpdates().find((u) => u.status === 'failed');
    expect(failed.meta.error).toBe('key_disagreement');
    expect(failed.meta.key_verify).toEqual(expect.objectContaining({ status: 'failed', dropped: 0 }));
    expect(insertedRows()).toBeNull();
    expect(WhatsAppService.sendDocument).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(TEACHER.phone_number, UX_STRINGS.tqFailedKeyDisagreement.ur);
    const ev = logEvent.mock.calls.find((c) => c[0] === 'transcript_quiz.failed');
    expect(ev[1]).toEqual(expect.objectContaining({ reason: 'key_disagreement', quiz_source: 'transcript' }));
  });
});

// ── the lp_v8 path runs it too, after the key check ─────────────────────────

describe('an lp_v8 quiz is blind-solved as well, after its key check', () => {
  const BAHAR_RIGHT = "آخر میں 'یں' لگانا";

  test('the key check passes it, the solver catches it, and the item is re-authored', async () => {
    llm({
      verify: (prompt, n) => solverFor(n === 1
        ? truthFrom(LP.AUTHORED, { [LP.BAHAR_STEM]: [BAHAR_RIGHT] })
        : truthFrom([LP.REKEYED]))(prompt),
      rewrite: () => ({ questions: [LP.REKEYED] }),
    });
    wireLp();

    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);

    // the key check ran first and found nothing; the solver ran after it
    const labels = completeJson.mock.calls.map((c) => c[0].label);
    expect(labels.indexOf('lp_quiz.key_check')).toBeGreaterThan(-1);
    expect(labels.indexOf('transcript_quiz.key_verify')).toBeGreaterThan(labels.indexOf('lp_quiz.key_check'));

    const rows = insertedRows();
    expect(rows).toHaveLength(8);
    expect(keyedTexts(rowFor(rows, LP.BAHAR_STEM))).not.toContain(LP.WRONG_KEY);

    const ready = readyUpdate();
    expect(ready.meta.key_check).toEqual(expect.objectContaining({ status: 'clean' }));
    expect(ready.meta.key_verify).toEqual(expect.objectContaining({ status: 'fixed', disagreed: 1, fixed: 1 }));
    expect(verifyEvent()).toEqual(expect.objectContaining({ quiz_source: 'lp_v8', status: 'fixed' }));
    // An lp_v8 rewrite keeps the plan's voice.
    expect(callsLabelled('transcript_quiz.rewrite')[0][0].prompt).toMatch(/q6: KEY_DISAGREEMENT/);
  });

  test('under the floor, an lp_v8 quiz fails with the LP copy for this reason', async () => {
    llm({
      verify: solverFor(truthFrom(LP.AUTHORED, {
        [LP.BAHAR_STEM]: [BAHAR_RIGHT], [LP.AUTHORED[1].question]: ['کتابا'], [LP.AUTHORED[3].question]: ['بستیں'],
      })),
      rewrite: () => ({ questions: [] }),
    });
    wireLp();

    const r = await Gen.process(QID, {});
    expect(r).toEqual(expect.objectContaining({ failed: true, reason: 'key_disagreement' }));
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(TEACHER.phone_number, UX_STRINGS.tqFailedLpKeyDisagreement.ur);
  });
});

// ── the pure parts ───────────────────────────────────────────────────────────

describe('the solver\'s contract, asserted in code', () => {
  let KV;
  beforeEach(() => { KV = require('../../bot/shared/services/quiz/transcript-quiz-key-verify.service'); });

  const items = () => F.AUTHORED.map((q, i) => KV.itemFor(q, i, QID));

  test('an answer is compared with the key through the shuffle the solver was shown', () => {
    const it = items();
    const shownRight = (i, text) => it[i].order.findIndex((authored) => clean(F.AUTHORED[i].options[authored]) === clean(text));
    const v = KV.parseAnswers({ answers: [
      { index: 0, correct: [shownRight(0, 'بکری')] },
      { index: 6, correct: [shownRight(6, F.HAAL_RIGHT)], note: 'حال is spelled ح ا ل' },
      { index: 3, correct: [shownRight(3, F.SALAAM_KEY), shownRight(3, F.SALAAM_TWIN)] },
      { index: 2, correct: [] },
      { index: 4, correct: [0], unsure: true },
      { index: 5, correct: [7] },
      { index: 1, correct: 'A' },
    ] }, it);
    const by = Object.fromEntries(v.map((x) => [x.index, x]));
    expect(by[0].verdict).toBe('agree');
    expect(by[6]).toEqual(expect.objectContaining({ verdict: 'disagree', blind: [1], keyed: [0], note: 'حال is spelled ح ا ل' }));
    expect(by[3]).toEqual(expect.objectContaining({ verdict: 'ambiguous', blind: [0, 1] }));
    expect(by[2].verdict).toBe('none_correct');
    expect(by[4].verdict).toBe('unclear');
    expect(by[5].verdict).toBe('unclear');       // an option number that was never shown
    expect(by[1].verdict).toBe('unclear');       // not a list
    expect(by[7]).toEqual(expect.objectContaining({ verdict: 'unclear', missing: true }));
  });

  test('a reply with no "answers" array is a failed solve, never "every key is fine"', () => {
    expect(() => KV.parseAnswers({ verdicts: [] }, items())).toThrow(/answers/);
    expect(() => KV.parseAnswers(null, items())).toThrow(/answers/);
  });

  test('the shown order is a stable shuffle, and not simply the authored order everywhere', () => {
    const a = items().map((x) => x.order.join(''));
    const b = items().map((x) => x.order.join(''));
    expect(a).toEqual(b);
    expect(a.some((o) => o !== '012')).toBe(true);
  });

  test('the prompt carries the grade, the subject, the objectives and the summary — and no key', () => {
    const prompt = KV.buildVerifyPrompt({
      items: items(), language: 'ur', grade: '3', subject: 'urdu', digest: F.DIGEST, lessonSummary: F.LESSON_SUMMARY,
    });
    expect(prompt).toContain('Urdu');
    expect(prompt).toMatch(/grade 3/i);
    expect(prompt).toContain(F.DIGEST.slos[1].statement_ur);
    expect(prompt).toContain(F.LESSON_SUMMARY);
    expect(prompt).not.toMatch(/correct_index|marked correct/i);
    expect(prompt).not.toContain('درست جواب');
  });

  test('a multi-select item is judged as a set', () => {
    const q = {
      question: 'ان میں سے کون سے الفاظ «س» سے شروع ہوتے ہیں؟', options: ['سلام', 'سبق', 'حال', 'دعا'],
      answer_mode: 'multi', correct_indices: [0, 1],
    };
    const it = [KV.itemFor(q, 0, QID)];
    const shown = (text) => it[0].order.findIndex((a) => q.options[a] === text);
    expect(KV.parseAnswers({ answers: [{ index: 0, correct: [shown('سلام'), shown('سبق')] }] }, it)[0].verdict).toBe('agree');
    expect(KV.parseAnswers({ answers: [{ index: 0, correct: [shown('سلام')] }] }, it)[0].verdict).toBe('disagree');
  });
});

describe('the failure copy', () => {
  const { LANGUAGE_OFFER } = require('../../bot/shared/config/languages');
  const { resolveUx } = require('../../bot/shared/config/ux-strings');
  const { genderedTeacherForms } = require('../../bot/shared/services/quiz/transcript-quiz-pedagogy');

  test.each(['tqFailedKeyDisagreement', 'tqFailedLpKeyDisagreement'])('%s exists in every offered language, fits, takes no params and is gender-neutral', (key) => {
    for (const lang of LANGUAGE_OFFER) {
      const s = UX_STRINGS[key][lang];
      expect(typeof s).toBe('string');
      expect([...s].length).toBeLessThanOrEqual(1024);
      expect(() => resolveUx(key, { language: lang })).not.toThrow();
      expect(s).not.toMatch(/\b(she|her|hers|herself|he|him|his|himself)\b/i);
      expect(genderedTeacherForms(s, lang)).toEqual([]);
      // It says what happened — the answers — not a recording or transcript fault.
      expect(s.toLowerCase()).not.toMatch(/recording|transcript/);
      expect(s).not.toBe(UX_STRINGS.tqCouldNotMake[lang]);
      expect(s).not.toBe(UX_STRINGS.tqFailedLpKeyConflict[lang]);
    }
  });

  test('key_disagreement has its own copy on both sources; other transcript reasons are untouched', () => {
    expect(failureCopyKey('key_disagreement', 'transcript')).toBe('tqFailedKeyDisagreement');
    expect(failureCopyKey('key_disagreement', 'lp_v8')).toBe('tqFailedLpKeyDisagreement');
    expect(failureCopyKey('validator_failed', 'transcript')).toBe('tqCouldNotMake');
    expect(failureCopyKey('key_conflict', 'transcript')).toBe('tqCouldNotMake');
  });
});
