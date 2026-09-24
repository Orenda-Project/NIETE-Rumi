'use strict';
/**
 * The lesson-plan quiz cache: a teacher served the same version of a lesson as
 * a teacher whose quiz already shipped gets that quiz's questions — no digest,
 * no author, no key checks — with THEIR OWN share code, name and lesson date.
 *
 * The generate step runs for real. Mocked: the network boundary (supabase,
 * WhatsApp, the queue, R2, the PDF renderer, Redis) and the LLM-backed digest
 * and author (asserted NOT called on a hit).
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-digest.service', () => ({ run: jest.fn(), normaliseDigest: jest.fn() }));
jest.mock('../../bot/shared/services/quiz/lp-quiz-digest.service', () => ({
  run: jest.fn(), lessonExcerpts: jest.fn().mockReturnValue('WHAT THE CLASS WAS TO LEARN: add with carrying'),
  lessonDrewBlock: jest.fn().mockReturnValue(''),
}));
jest.mock('../../bot/shared/services/quiz/lp-asset-source.store', () => ({ resolveSlideScript: jest.fn() }));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-author.service', () => ({
  author: jest.fn(), excerptsFor: jest.fn().mockReturnValue('…'),
}));
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  mintCode: jest.fn().mockResolvedValue({ id: 'sc-new', code: 'NEW234', teacherName: 'Rifat Noor', topic: 'Carrying' }),
  botNumber: jest.fn().mockReturnValue('923000000000'),
}));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')) }));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn(async (_b, key) => `https://r2/${key}`),
  downloadFromR2: jest.fn(async () => Buffer.from('png')),
  extractKeyFromUrl: jest.fn((url) => String(url).replace(/^https:\/\/r2\//, '')),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
const mockLocks = new Map();
const mockRedis = { available: true };
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  isAvailable: () => mockRedis.available,
  acquireLock: jest.fn(async (res, id) => { if (mockLocks.has(res)) return false; mockLocks.set(res, id); return true; }),
  releaseLock: jest.fn(async (res, id) => { if (mockLocks.get(res) !== id) return false; mockLocks.delete(res); return true; }),
  evalScript: jest.fn(async () => null),
}));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const SQS = require('../../bot/shared/services/queue/sqs-queue.service');
const Author = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
const LpDigest = require('../../bot/shared/services/quiz/lp-quiz-digest.service');
const Store = require('../../bot/shared/services/quiz/lp-asset-source.store');
const Share = require('../../bot/shared/services/quiz/video-quiz-share.service');
const { htmlToPdf } = require('../../bot/shared/utils/html-to-pdf');
const Redis = require('../../bot/shared/services/cache/railway-redis.service');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const { installFrom } = require('./helpers/supabase-chain');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
const Cache = require('../../bot/shared/services/quiz/lp-quiz-cache');
const { installAgreeingSolver } = require('./helpers/key-verify-agree');
const { installNoPictureRepair } = require('./helpers/no-picture-repair');

const QID = '44444444-4444-4444-8444-444444444444';
const DONOR_ID = '55555555-5555-4555-8555-555555555555';
const LESSON = {
  lesson_id: 'grade_2_math_ch9_seg3', asset_id: 'a-1', version_stamp: 'v8-20260901', content_hash: 'h-abc', delivered_at: '2026-09-24T04:10:00Z',
};
const LP_QUIZ = {
  id: QID, teacher_id: 'u-1', coaching_session_id: null, quiz_source: 'lp_v8', topic: 'Add a 3-digit and a 2-digit number',
  subject: 'maths', language: 'en', status: 'generating', grade: '2',
  meta: {
    step: 'generating', source: 'lp_offer', nudge_id: 'n-1', lessons: [LESSON], class: { grade: 2, subject: 'maths' }, lesson_date: '2026-09-24',
  },
};
const USER = { id: 'u-1', name: 'Rifat Noor', phone_number: '923001234567', preferred_language: 'en' };
const SLIDE_SCRIPT = { meta: { lessonId: LESSON.lesson_id, grade: 2, subject: 'math' }, goal: 'Add with carrying' };
const DIGEST = {
  topic: 'Adding with carrying', topic_as_taught: 'Adding with carrying', subject: 'maths', grade_band: '1-2', confidence: 0.9,
  taught_level: 'apply',
  slos: [{ id: 'S1', statement: 'a', statement_en: 'a', statement_ur: 'ا', taught_level: 'apply' },
    { id: 'S2', statement: 'b', statement_en: 'b', statement_ur: 'ب', taught_level: 'understand' }],
  key_terms: [], examples_used: ['146 + 27'], misconceptions_surfaced: [],
};

// Everything teacher-specific on the donor — none of it may reach the new quiz.
const DONOR_SECRETS = {
  teacherName: 'Donor Teacher Zzqx', shareCode: 'OLDQ77', shareCodeId: 'sc-donor-9f', lessonDate: '2026-09-03',
  link: 'https://wa.me/923000000000?text=QUIZ-OLDQ77', pdfKey: 'transcript_quizzes/u-donor/old.pdf', nudge: 'n-donor-71',
};
function donorRow(over = {}) {
  const meta = {
    step: 'ready', source: 'lp_offer', nudge_id: DONOR_SECRETS.nudge, lessons: [{ ...LESSON, asset_id: 'a-1', delivered_at: '2026-09-02T04:00:00Z' }],
    class: { grade: 2, subject: 'maths', section: 'Zeta-9' }, lesson_date: DONOR_SECRETS.lessonDate,
    digest: DIGEST, grade: '2', grade_source: 'catalog', lesson_summary: 'You planned column addition.',
    lesson_summary_short: 'Column addition.', question_count: 2,
    key_verify: { status: 'clean' }, key_check: { status: 'clean' }, cost_usd: 0.041,
    share_code: DONOR_SECRETS.shareCode, share_code_id: DONOR_SECRETS.shareCodeId, link: DONOR_SECRETS.link,
    student_message: `${DONOR_SECRETS.teacherName} sent a quiz ${DONOR_SECRETS.link}`, pdf_key: DONOR_SECRETS.pdfKey,
    teacher_name: DONOR_SECRETS.teacherName, class_cards: { sent: 3 }, sent_at: '2026-09-03T09:00:00Z',
    ...(over.meta || {}),
  };
  return {
    id: DONOR_ID, quiz_source: 'lp_v8', topic: 'Adding with carrying', subject: 'maths', grade: '2', language: 'en',
    status: 'sent', created_at: new Date(Date.now() - 3 * 864e5).toISOString(), teacher_id: 'u-donor',
    ...over, meta,
  };
}
const DONOR_Q = [0, 1].map((i) => ({
  question_text: `What is ${146 + i} + 27?`, option_a: `${173 + i}`, option_b: `${163 + i}`, option_c: `${183 + i}`,
  correct_option: 'A', explanation: 'Ones first.', misconception_feedback: null, distractor_misconceptions: null,
  option_feedback: { correct: 'Yes', wrong: {} }, difficulty_level: 3,
  media: { language: 'en', display_order: [2, 0, 1], question_card: `https://r2/transcript_quizzes/u-donor/${DONOR_ID}/card${i + 1}.png` },
  render_pattern: 'P1', sort_order: i, external_id: `tq:${DONOR_ID}:S${i + 1}:${i + 1}`,
  id: `row-donor-${i}`, quiz_id: DONOR_ID, created_at: '2026-09-03T08:00:00Z',
}));

function goodQuestion(i, slo, level) {
  return {
    slo_id: slo, level, question: `Question ${i}: what is ${100 + i} + ${20 + i}?`,
    options: [`${120 + 2 * i}`, `${130 + 2 * i}`, `${110 + 2 * i}`], correct_index: 0,
    explanation: `Add the ones, then the tens: ${120 + 2 * i}.`,
    selected_because: `Question ${i} checks adding two numbers in columns.`,
    distractor_misconceptions: { 1: 'carried when no column reached ten', 2: 'dropped a ten' },
    option_feedback: { correct: 'Yes — ones first, then tens.', wrong: { 1: 'No column reached ten, so nothing carries.', 2: 'A ten was lost from the tens column.' } },
  };
}
const EIGHT = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => goodQuestion(i, i % 2 ? 'S1' : 'S2', i % 2 ? 'apply' : 'understand'));

beforeEach(() => {
  jest.clearAllMocks();
  mockLocks.clear();
  mockRedis.available = true;
  delete process.env.QUIZ_LP_CACHE;
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
  installAgreeingSolver(Gen);
  installNoPictureRepair(Gen);
  Store.resolveSlideScript.mockResolvedValue({ slideScript: SLIDE_SCRIPT, verified: 'upload', assetId: 'a-1' });
  LpDigest.run.mockResolvedValue({ digest: DIGEST, grade: '2', gradeSource: 'catalog', lpHint: null, model: 'dm', costUsd: 0.002, latencyMs: 10 });
  Author.author.mockResolvedValue({ questions: EIGHT, model: 'm', costUsd: 0.01, latencyMs: 100, lessonSummary: 'You planned column addition.' });
});

/** donors: what a donor query returns; the quiz's own read returns `quiz`. */
function wire({ quiz = LP_QUIZ, donors = [donorRow()], donorQuestions = DONOR_Q } = {}) {
  installFrom(supabase.from, ({
    quizzes: (calls) => {
      if (calls.some((c) => c[0] === 'update')) return { data: [{ id: QID }] };
      // the donor lookup filters on the served lesson; the quiz's own read is by id
      if (calls.some((c) => c[0] === 'eq' && String(c[1]).startsWith('meta->lessons->0->>'))) return { data: donors };
      return { data: [quiz] };
    },
    quiz_questions: (calls) => {
      if (calls.some((c) => c[0] === 'insert' || c[0] === 'delete')) return { data: null, error: null };
      if (calls.some((c) => c[0] === 'eq' && c[1] === 'quiz_id' && c[2] === DONOR_ID)) return { data: donorQuestions };
      return { data: [] };
    },
    users: { data: [USER] },
  }));
}
const quizUpdates = () => supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update').map((u) => u[1]);
const inserted = () => supabase.from.callsFor('quiz_questions').flat().filter((c) => c[0] === 'insert').map((c) => c[1]).flat();

describe('a hit: the donor quiz is reused', () => {
  test('no digest, no author, no checks; the donor questions are stored as THIS quiz', async () => {
    wire();
    const r = await Gen.process(QID, {});
    expect(r).toEqual(expect.objectContaining({ ok: true }));
    expect(LpDigest.run).not.toHaveBeenCalled();
    expect(Author.author).not.toHaveBeenCalled();
    expect(Gen.verifyKeys).not.toHaveBeenCalled();

    const rows = inserted();
    expect(rows).toHaveLength(2);
    rows.forEach((row, i) => {
      expect(row.quiz_id).toBe(QID);
      expect(row.id).toBeUndefined();
      expect(row.created_at).toBeUndefined();
      expect(row.external_id).toBe(`tq:${QID}:S${i + 1}:${i + 1}`);
      // the stored display order and card travel together, so letters and buttons agree
      expect(row.media.display_order).toEqual([2, 0, 1]);
      expect(row.question_text).toBe(DONOR_Q[i].question_text);
    });

    const ready = quizUpdates().find((u) => u.status === 'ready');
    expect(ready.meta.cache_donor).toEqual(expect.objectContaining({ quiz_id: DONOR_ID }));
    expect(ready.meta.digest).toEqual(DIGEST);
    expect(ready.meta.question_count).toBe(2);
    expect(ready.meta.cost_usd || 0).toBe(0);
    // THIS teacher's lessons, class, nudge and date stay on the row
    expect(ready.meta.lessons).toEqual([LESSON]);
    expect(ready.meta.nudge_id).toBe('n-1');
    expect(ready.meta.lesson_date).toBe('2026-09-24');
    expect(ready.meta.class).toEqual({ grade: 2, subject: 'maths' });
  });

  test('nothing teacher-specific leaks from the donor: name, date, class, share code, link, PDF, children', async () => {
    wire();
    await Gen.process(QID, {});
    const written = JSON.stringify({ u: quizUpdates(), q: inserted() });
    for (const s of Object.values(DONOR_SECRETS)) expect(written).not.toContain(s);
    expect(written).not.toContain('Zeta-9');
    expect(written).not.toContain('class_cards');
    expect(written).not.toContain('u-donor');
    const sent = JSON.stringify([WhatsAppService.sendMessage.mock.calls, WhatsAppService.sendDocument.mock.calls]);
    for (const s of Object.values(DONOR_SECRETS)) expect(sent).not.toContain(s);
  });

  test('a new share code is minted for THIS quiz, and the PDF carries THIS teacher and lesson date', async () => {
    wire();
    await Gen.process(QID, {});
    expect(Share.mintCode).toHaveBeenCalledWith(expect.objectContaining({ quizId: QID, userId: 'u-1' }));
    const forwardable = WhatsAppService.sendMessage.mock.calls[0][1];
    expect(forwardable).toContain('NEW234');
    expect(forwardable).toMatch(/24 Sep/);
    const html = htmlToPdf.mock.calls[0][0];
    expect(html).toContain('Rifat Noor');
    expect(html).not.toContain(DONOR_SECRETS.teacherName);
    const sent = quizUpdates().find((u) => u.status === 'sent');
    expect(sent.meta.share_code_id).toBe('sc-new');
  });

  test('the pictures are copied under THIS quiz — no row points at the donor\'s objects', async () => {
    wire();
    await Gen.process(QID, {});
    const R2 = require('../../bot/shared/storage/r2');
    inserted().forEach((row, i) => {
      expect(row.media.question_card).toBe(`https://r2/transcript_quizzes/u-1/${QID}/card${i + 1}.png`);
    });
    expect(R2.downloadFromR2).toHaveBeenCalledWith(`transcript_quizzes/u-donor/${DONOR_ID}/card1.png`);
  });

  test('a picture that cannot be copied: the quiz is authored, never shipped without it', async () => {
    const R2 = require('../../bot/shared/storage/r2');
    R2.downloadFromR2.mockRejectedValueOnce(new Error('NoSuchKey'));
    wire();
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(Author.author).toHaveBeenCalled();
  });

  test('telemetry: quiz_funnel.generated {cached:true, donor_quiz_id}', async () => {
    wire();
    await Gen.process(QID, {});
    const gen = logEvent.mock.calls.find((c) => c[0] === 'quiz_funnel.generated');
    expect(gen[1]).toEqual(expect.objectContaining({ quiz_id: QID, cached: true, donor_quiz_id: DONOR_ID, source: 'lp_v8' }));
  });
});

describe('who may donate', () => {
  test.each([
    ['the blind solve did not run (error)', { meta: { key_verify: { status: 'error' } } }],
    ['the key check failed', { meta: { key_check: { status: 'failed' } } }],
    ['it shipped with a soft fault', { meta: { soft_faults: ['q2: something'] } }],
    ['it is itself a copy', { meta: { cache_donor: { quiz_id: 'x' } } }],
    ['it was never sent', { status: 'ready' }],
    ['it is another version of the lesson', { meta: { lessons: [{ ...LESSON, content_hash: 'h-other' }] } }],
    ['it is in another language', { language: 'ur' }],
    ['it is older than the age limit', { created_at: new Date(Date.now() - 45 * 864e5).toISOString() }],
  ])('not when %s — the quiz is authored', async (_why, over) => {
    wire({ donors: [donorRow(over)] });
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(Author.author).toHaveBeenCalled();
    expect(quizUpdates().find((u) => u.status === 'ready').meta.cache_donor).toBeUndefined();
  });

  test('a donor whose stored rows are fewer than it shipped is no donor', async () => {
    wire({ donorQuestions: DONOR_Q.slice(0, 1) });
    await Gen.process(QID, {});
    expect(Author.author).toHaveBeenCalled();
  });

  test('a quiz made again after a failure is preferred over a newer one', () => {
    const newer = donorRow({ id: 'newer', created_at: new Date(Date.now() - 864e5).toISOString() });
    const remade = donorRow({ id: 'remade', meta: { remakes: 1 } });
    const key = Cache.cacheKey(LP_QUIZ, 'en');
    const eligible = [newer, remade].filter((r) => Cache.eligibleDonor(r, key));
    expect(eligible).toHaveLength(2);
    expect(eligible.sort(Cache.rank).map((r) => r.id)).toEqual(['remade', 'newer']);
  });
});

describe('bypasses', () => {
  test('"Make it again" (meta.remakes > 0) authors fresh and never looks for a donor', async () => {
    wire({ quiz: { ...LP_QUIZ, meta: { ...LP_QUIZ.meta, remakes: 1 } } });
    await Gen.process(QID, {});
    expect(Author.author).toHaveBeenCalled();
    const lookedUp = supabase.from.callsFor('quizzes').some((calls) => calls.some((c) => c[0] === 'eq' && String(c[1]).startsWith('meta->lessons')));
    expect(lookedUp).toBe(false);
  });

  test('QUIZ_LP_CACHE=off authors every time', async () => {
    process.env.QUIZ_LP_CACHE = 'off';
    wire();
    await Gen.process(QID, {});
    expect(Author.author).toHaveBeenCalled();
  });

  test('a transcript quiz is never looked up', () => {
    expect(Cache.cacheKey({ quiz_source: 'transcript', meta: { lessons: [LESSON] } }, 'en')).toBeNull();
  });
});

describe('single flight', () => {
  const key = () => Cache.cacheKey(LP_QUIZ, 'en');

  test('a miss takes the lock while it authors and gives it back', async () => {
    wire({ donors: [] });
    await Gen.process(QID, {});
    expect(Author.author).toHaveBeenCalled();
    expect(Redis.acquireLock).toHaveBeenCalledWith(`lpquizcache:${key()}`, QID, expect.any(Number));
    expect(Redis.releaseLock).toHaveBeenCalledWith(`lpquizcache:${key()}`, QID);
    expect(mockLocks.size).toBe(0);
  });

  test('another teacher authoring the same lesson: the job waits (re-queued), it does not author', async () => {
    mockLocks.set(`lpquizcache:${key()}`, 'other-quiz');
    wire({ donors: [] });
    const r = await Gen.process(QID, { phone: USER.phone_number });
    expect(r).toEqual(expect.objectContaining({ deferred: 'cache_wait' }));
    expect(Author.author).not.toHaveBeenCalled();
    expect(SQS.queueJob).toHaveBeenCalledWith(QID, 'quiz_generate',
      expect.objectContaining({ quizId: QID, cache_waits: 1 }), expect.objectContaining({ delaySeconds: 60 }));
    // nothing written, nothing sent — the teacher was already told it is coming
    expect(quizUpdates().some((u) => u.status === 'failed')).toBe(false);
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
  });

  test('…and when the other quiz has shipped by the next look, it is a hit', async () => {
    mockLocks.set(`lpquizcache:${key()}`, 'other-quiz');
    wire();
    const r = await Gen.process(QID, { cache_waits: 1 });
    expect(r.ok).toBe(true);
    expect(Author.author).not.toHaveBeenCalled();
  });

  test('after the last wait it authors anyway', async () => {
    mockLocks.set(`lpquizcache:${key()}`, 'other-quiz');
    wire({ donors: [] });
    const r = await Gen.process(QID, { cache_waits: 3 });
    expect(r.ok).toBe(true);
    expect(Author.author).toHaveBeenCalled();
    expect(SQS.queueJob.mock.calls.filter((c) => c[1] === 'quiz_generate')).toHaveLength(0);
  });

  test('Redis down: no lock, no wait — it authors (the behaviour before the cache)', async () => {
    mockRedis.available = false;
    wire({ donors: [] });
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);
    expect(Author.author).toHaveBeenCalled();
    expect(Redis.acquireLock).not.toHaveBeenCalled();
  });
});
