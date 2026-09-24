'use strict';
/**
 * A grade 1 maths lesson on the numbers 0 to 4, quizzed in Urdu from its lesson
 * plan, that ended `failed / validator_failed` after three attempts (sandbox,
 * 24 Sep 2026). Its attempt log showed three fault families; each is pinned
 * here by driving the REAL generate/repair loop — the validator, the drawing
 * engine, the targeted rewrite, the teacher-fields repair — with only the
 * network boundary mocked (the LLM client answers with the drafts the log
 * recorded; synthetic text, see helpers/g1-numbers-urdu-fixture).
 *
 *   1. REPAIR ORDER. The teacher-fields repair ran right after the author, then
 *      the targeted rewrite replaced five questions and wrote their
 *      `selected_because` in English again — and nothing repaired those. The
 *      attempt was thrown away with only teacher-page complaints left; two
 *      re-rolls later the quiz died.
 *   2. COUNTS 0 AND 1. "How many cars?" over one car and "how many counters in
 *      the box?" over an empty one are this lesson's own content; the drawing
 *      engine refused any count under 2.
 *   3. THE CHILD'S GENDER. A question rejected only for a verb that speaks to
 *      the child as a boy is repaired "in place" — keep the question, change
 *      only the verbs — but the rewrite was shown the stem and options alone,
 *      never the explanation and feedback its complaint named. It wrote those
 *      from scratch, with the same habit.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true), sendDocument: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true), sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendImageWithButtons: jest.fn().mockResolvedValue(true), sendTextReturningId: jest.fn().mockResolvedValue('m1'),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  mintCode: jest.fn().mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'A B', topic: 'x' }),
  botNumber: jest.fn().mockReturnValue('920000000000'),
}));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')) }));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn().mockResolvedValue('https://r2/x'), downloadFromR2: jest.fn(),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClientForModel: (model) => ({ client: { chat: { completions: { create: (...a) => mockCreate(...a) } } }, model }),
}));

const supabase = require('../../bot/shared/config/supabase');
const { installFrom } = require('./helpers/supabase-chain');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
const { installAgreeingSolver } = require('./helpers/key-verify-agree');
const { installNoPictureRepair } = require('./helpers/no-picture-repair');
const F = require('./helpers/g1-numbers-urdu-fixture');

const QID = '77777777-7777-4777-8777-777777777777';
const LESSON = { lesson_id: 'grade_1_maths_ch1_seg1', asset_id: 'a-1', version_stamp: 'v8-test', content_hash: 'h-test' };

function reply(obj) { return { choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: 'stop' }], usage: { cost: 0.01 } }; }
const promptOf = (call) => call[0].messages[0].content;
const kindOf = (p) => (/^REWRITE THE TEACHER FIELDS/.test(p) ? 'teacher_fields' : /^You are FIXING/.test(p) ? 'rewrite' : 'author');
const kinds = () => mockCreate.mock.calls.map((c) => kindOf(promptOf(c)));
const askedIndices = (p) => {
  const m = /REWRITE THESE QUESTIONS: ([^\n]+)/.exec(p) || /"index" being one of: ([^\n.]+)/.exec(p);
  return m ? m[1].split(',').map((s) => Number(s.trim().replace('q', ''))) : [];
};

/**
 * The model, as the attempt log recorded it: the author writes `draft`; the
 * teacher-fields repair answers in Urdu; the targeted rewrite answers each
 * question it is asked for with `rewriteOf(i)` — carrying an ENGLISH
 * `selected_because`, as every recorded replacement did.
 */
function model({ draft, rewriteOf }) {
  mockCreate.mockImplementation((call) => {
    const p = call.messages[0].content;
    const kind = kindOf(p);
    if (kind === 'author') return Promise.resolve(reply({ lesson_summary: F.SUMMARY, questions: draft() }));
    if (kind === 'teacher_fields') {
      return Promise.resolve(reply({
        fields: askedIndices(p).map((i) => ({
          index: i, selected_because: F.eight()[i].selected_because, distractor_misconceptions: F.eight()[i].distractor_misconceptions,
        })),
      }));
    }
    return Promise.resolve(reply({
      questions: askedIndices(p).map((i) => ({ index: i, ...rewriteOf(i), selected_because: F.ENGLISH_WHY[i], figure: null })),
    }));
  });
}

function wire() {
  installFrom(supabase.from, {
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [{
      id: QID, teacher_id: 'u-1', coaching_session_id: null, quiz_source: 'lp_v8', topic: 'Numbers 0 to 4',
      subject: 'maths', language: 'ur', status: 'generating', grade: '1',
      meta: { digest: F.DIGEST, grade: '1', step: 'author', source: 'flow', lessons: [LESSON], class: { grade: 1, subject: 'maths' } },
    }] }),
    niete_lp_asset_sources: { data: [{ asset_id: 'a-1', lesson_id: LESSON.lesson_id, version_stamp: LESSON.version_stamp, content_hash: LESSON.content_hash, slide_script: F.SLIDE_SCRIPT, verified: 'test' }] },
    quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
    users: { data: [{ id: 'u-1', name: 'A B', phone_number: '923001234567', preferred_language: 'ur' }] },
  });
}
const storedRows = () => { const ins = supabase.from.callsFor('quiz_questions').flat().filter((c) => c[0] === 'insert'); return ins.length ? ins[0][1] : []; };
const quizUpdates = () => supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update').map((u) => u[1]);
const URDU_WORDS = (s) => { const w = String(s || '').split(/\s+/).filter((x) => /\p{L}/u.test(x)); return w.length && w.filter((x) => /\p{Script=Arabic}/u.test(x)).length / w.length >= 0.5; };

beforeEach(() => {
  jest.clearAllMocks(); mockCreate.mockReset();
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'true'; delete process.env.TRANSCRIPT_QUIZ_MAX_ATTEMPTS;
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
  installAgreeingSolver(Gen);
  installNoPictureRepair(Gen);
  // The lesson-plan key check is not this suite's subject: every key agrees with the lesson.
  jest.spyOn(Gen, 'checkKeys').mockImplementation(async ({ questions }) => ({
    verdicts: questions.map((_, index) => ({ index, verdict: 'consistent' })), model: 'stub-check', costUsd: 0,
  }));
  jest.spyOn(Gen, 'renderFigures').mockResolvedValue({});
  jest.spyOn(Gen, 'renderCards').mockResolvedValue({});
});

/** The same set with no count under 2, so family 1 and 3 are measured apart from family 2. */
function twoAndUp(qs) {
  const out = qs.map((x) => ({ ...x }));
  out[1] = { ...out[1], options: ['2', '1', '3'], figure: { type: 'count_objects', picto: 'car', count: 2 } };
  out[4] = { ...out[4], question: 'ڈبے میں کتنے counter ہیں؟', options: ['2', '0', '1'], figure: { type: 'count_objects', picto: 'counter', count: 2 },
    explanation: 'ڈبے میں دو counter ہیں، اس لیے جواب 2 ہے۔' };
  return out;
}

describe('1 — the teacher-fields repair runs AFTER the targeted rewrite, not only before it', () => {
  test('a rewrite that writes selected_because in English again is repaired in place and the attempt ships (4 calls, no re-roll)', async () => {
    // attempt 1: English notes on all eight, q5 speaks to the child as a boy, q7 has two equal options
    const draft = () => {
      const qs = F.withEnglishWhy(twoAndUp(F.eight()));
      qs[5] = F.gendered(qs[5]);
      qs[7] = { ...qs[7], options: ['ایک بار', 'ایک بار', 'ایک بار بھی نہیں'] };
      return qs;
    };
    model({ draft, rewriteOf: (i) => (i === 5 ? F.neutral(twoAndUp(F.eight())[5]) : twoAndUp(F.eight())[i]) });
    wire();
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    // author → teacher fields → rewrite (q5, q7) → teacher fields again on what the rewrite wrote
    expect(kinds()).toEqual(['author', 'teacher_fields', 'rewrite', 'teacher_fields']);
    expect(askedIndices(promptOf(mockCreate.mock.calls[3]))).toEqual([5, 7]);
    const rows = storedRows();
    expect(rows).toHaveLength(8);
    rows.forEach((row) => expect(URDU_WORDS(row.media && row.media.selected_because)).toBe(true));
    // the repaired q5 is the one that shipped — no verb that guesses the child's gender
    expect(rows[5].question_text).toBe(F.neutral(F.eight()[5]).question);
    const last = quizUpdates().pop();
    expect(last.meta.author_attempts.map((a) => a.attempt)).toEqual([1, 'teacher_fields', 'rewrite', 'teacher_fields']);
    expect(last.meta.author_attempts[3].after).toBe('rewrite');
  });

  test('the rewrite prompt of an Urdu quiz states the teacher-field language rule for every replacement, complained of or not', async () => {
    const draft = () => { const qs = twoAndUp(F.eight()); qs[7] = { ...qs[7], options: ['ایک بار', 'ایک بار', 'ایک بار بھی نہیں'] }; return qs; };
    model({ draft, rewriteOf: (i) => twoAndUp(F.eight())[i] });
    wire();
    await Gen.process(QID, {});
    const rewrite = mockCreate.mock.calls.map((c) => promptOf(c)).find((p) => kindOf(p) === 'rewrite');
    // q7's only complaint is its options — nothing about its notes — and its
    // replacement's notes are printed on the teacher's Urdu page all the same
    expect(rewrite).toMatch(/TEACHER FIELDS\. "selected_because" and every "distractor_misconceptions" entry are printed on the TEACHER's Urdu page/);
  });
});

describe('2 — a count of 1 and a count of 0 are this lesson\'s own content', () => {
  test('"how many cars?" over one car and "how many counters in the box?" over an empty box ship on the first attempt', async () => {
    model({ draft: () => F.eight(), rewriteOf: (i) => F.eight()[i] });
    wire();
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(kinds()).toEqual(['author']);
    const rows = storedRows();
    expect(rows).toHaveLength(8);
    const last = quizUpdates().pop();
    expect(last.meta.author_attempts).toHaveLength(1);
    expect(last.meta.author_attempts[0].errors.filter((e) => /FIGURE_/.test(e))).toEqual([]);
  });
});

describe('4 — the lesson-plan key check sees the picture the child answers from', () => {
  // Replayed on this lesson (8 runs after fixes 1-3): the key check flagged
  // "how many butterflies?" over a picture of THREE butterflies, keyed 3,
  // because the lesson's own example counted two — in 6 of 8 runs. It was
  // shown the stem, the options and the key, never the picture; its rewrite
  // then wrote a text question that still pointed at a picture, and 2 of 8
  // quizzes shipped 6 or 7 questions instead of 8.
  test('the checker is given each question\'s picture, and told a picture question is answered by reading it', async () => {
    model({ draft: () => F.eight(), rewriteOf: (i) => F.eight()[i] });
    const answer = mockCreate.getMockImplementation();
    mockCreate.mockImplementation((call) => {
      const p = call.messages[0].content;
      if (/^You are CHECKING THE ANSWER KEY/.test(p)) {
        const idx = [...p.matchAll(/^q(\d+): /gm)].map((m) => Number(m[1]));
        return Promise.resolve(reply({ verdicts: idx.map((index) => ({ index, verdict: 'consistent', quote: '' })) }));
      }
      return answer(call);
    });
    Gen.checkKeys.mockRestore();
    wire();
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    const check = mockCreate.mock.calls.map((c) => promptOf(c)).find((p) => /^You are CHECKING THE ANSWER KEY/.test(p));
    expect(check).toBeDefined();
    // q1 draws one car, q2 three flowers, q4 an empty box — each item carries its picture
    expect(check).toMatch(/q1: [^\n]*\n  options: [^\n]*\n  marked correct: [^\n]*\n  picture the child answers from: count_objects — 1 × car/);
    expect(check).toMatch(/q2: [^\n]*\n[\s\S]*?picture the child answers from: count_objects — 3 × flower/);
    expect(check).toMatch(/q4: [^\n]*\n[\s\S]*?picture the child answers from: count_objects — 0 × counter \(an empty tray\)/);
    expect(check).not.toMatch(/q0: [^\n]*\n  options: [^\n]*\n  marked correct: [^\n]*\n  picture/);
    expect(check).toMatch(/A question with a PICTURE is answered by reading that picture/);
  });
});

describe('5 — an LP-born quiz keeps the subject of the lesson it was made from', () => {
  // Staging, 24 Sep 2026: a grade 1 URDU lesson on the manners of visiting the
  // sick was stored as `islamiat` and the teacher was told "Your quiz:
  // Islamiyat lesson on …". The catalog said urdu (meta.class, the lesson id);
  // the digest model read the content as Islamiyat, and its reading replaced
  // the catalog's on the row.
  test('the digest model\'s reading of the content never replaces the catalog subject', async () => {
    mockCreate.mockImplementation((call) => {
      const p = call.messages[0].content;
      if (/^You are reading the LESSON PLAN/.test(p)) {
        return Promise.resolve(reply({ ...F.DIGEST, subject: 'islamiat', subject_conflict: false, topic: 'Etiquette of visiting the sick' }));
      }
      return Promise.resolve(reply({ lesson_summary: F.SUMMARY, questions: F.eight() }));
    });
    const lesson = { ...LESSON, lesson_id: 'grade_1_urdu_ch5_seg1' };
    installFrom(supabase.from, {
      quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [{
        id: QID, teacher_id: 'u-1', coaching_session_id: null, quiz_source: 'lp_v8', topic: 'Urdu lesson',
        subject: 'urdu', language: 'ur', status: 'generating', grade: '1',
        meta: { step: 'digest', source: 'flow', lessons: [lesson], class: { grade: 1, subject: 'urdu' } },
      }] }),
      niete_lp_asset_sources: { data: [{ asset_id: 'a-1', lesson_id: lesson.lesson_id, version_stamp: lesson.version_stamp, content_hash: lesson.content_hash, slide_script: { ...F.SLIDE_SCRIPT, meta: { ...F.SLIDE_SCRIPT.meta, lessonId: lesson.lesson_id, subject: 'urdu' } }, verified: 'test' }] },
      quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
      users: { data: [{ id: 'u-1', name: 'A B', phone_number: '923001234567', preferred_language: 'ur' }] },
    });
    await Gen.process(QID, {});
    const withSubject = quizUpdates().filter((u) => u.subject !== undefined);
    expect(withSubject.length).toBeGreaterThan(0);
    withSubject.forEach((u) => expect(u.subject).toBe('urdu'));
    const digested = quizUpdates().find((u) => u.meta && u.meta.digest);
    expect(digested.meta.digest.subject).toBe('urdu');
    // the disagreement is kept, for the record — never acted on
    expect(digested.meta.digest.subject_conflict).toBe(true);
    expect(digested.meta.digest.subject_read).toBe('islamiat');
  });
});

describe('3 — an in-place repair is shown the fields it is told to keep', () => {
  test('a question rejected only for a gendered verb reaches the rewrite with its explanation, feedback and notes', async () => {
    const draft = () => {
      const qs = twoAndUp(F.eight());
      qs[5] = F.gendered(qs[5]);
      qs[7] = { ...qs[7], options: ['ایک بار', 'ایک بار', 'ایک بار بھی نہیں'] };
      return qs;
    };
    model({ draft, rewriteOf: (i) => (i === 5 ? F.neutral(twoAndUp(F.eight())[5]) : twoAndUp(F.eight())[i]) });
    wire();
    await Gen.process(QID, {});
    const rewrite = mockCreate.mock.calls.map((c) => promptOf(c)).find((p) => kindOf(p) === 'rewrite');
    const g = F.gendered(F.eight()[5]);
    // the complaint names "question + explanation + option_feedback": all three are in front of the model
    expect(rewrite).toContain(g.explanation);
    expect(rewrite).toContain(g.option_feedback.correct);
    expect(rewrite).toContain(g.option_feedback.wrong[1]);
    // and the teacher's note it must keep (already Urdu, repaired before the rewrite)
    expect(rewrite).toContain(F.eight()[5].selected_because);
  });

  test('the author is shown the neutral counting stem — and NOT a counting rule in the child-address contract', async () => {
    // A sentence naming the masculine counting stem («آپ کتنی کاریں گنتے ہیں؟»)
    // was tried in the child-address rule and A/B-tested against the author
    // alone: with it, 11-14 of 15 drafts wrote their teacher notes in English;
    // without it, 2 of 15 (runs/ab in the lane folder). The neutral stem is
    // modelled in the counting picture's own example instead.
    model({ draft: () => F.eight(), rewriteOf: (i) => F.eight()[i] });
    wire();
    await Gen.process(QID, {});
    const author = promptOf(mockCreate.mock.calls[0]);
    expect(author).toContain('one car under «تصویر میں کتنی کاریں ہیں؟»');
    expect(author).not.toContain('never «آپ کتنی کاریں گنتے ہیں؟»');
  });

  test('a picture question repaired in place keeps its picture', async () => {
    // q2 (three flowers) speaks to the child as a boy; the repair changes its verbs only
    const draft = () => {
      const qs = twoAndUp(F.eight());
      qs[2] = { ...qs[2], question: 'تصویر میں آپ کتنے پھول گنتے ہیں؟' };
      qs[7] = { ...qs[7], options: ['ایک بار', 'ایک بار', 'ایک بار بھی نہیں'] };
      return qs;
    };
    // the model returns the kept question as told — "figure" left out (null) —
    // and the verbs neutral; before, the merge stripped every replacement's picture
    model({ draft, rewriteOf: (i) => ({ ...twoAndUp(F.eight())[i] }) });
    wire();
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    const rewrite = mockCreate.mock.calls.map((c) => promptOf(c)).find((p) => kindOf(p) === 'rewrite');
    expect(rewrite).toMatch(/q2 · slo_id "S1" · level "understand" · REPAIR IN PLACE/);
    const last = quizUpdates().pop();
    const stored = storedRows();
    expect(stored[2].question_text).toBe(F.eight()[2].question);
    // the picture it was drawn with is still on the question the teacher gets
    const q2 = last.meta.author_attempts.find((a) => a.attempt === 'rewrite');
    expect(q2.replaced).toContain(2);
    expect(Gen.renderFigures.mock.calls.pop()[0].questions[2].figure).toEqual({ type: 'count_objects', picto: 'flower', count: 3 });
  });

  test('a question that is RE-ASKED (a hard fault) is not anchored on its old explanation', async () => {
    const draft = () => { const qs = twoAndUp(F.eight()); qs[7] = { ...qs[7], options: ['ایک بار', 'ایک بار', 'ایک بار بھی نہیں'] }; return qs; };
    model({ draft, rewriteOf: (i) => twoAndUp(F.eight())[i] });
    wire();
    await Gen.process(QID, {});
    const rewrite = mockCreate.mock.calls.map((c) => promptOf(c)).find((p) => kindOf(p) === 'rewrite');
    expect(rewrite).not.toContain(F.eight()[7].explanation);
  });
});
