'use strict';
/**
 * A Grades 6-12 lesson plan as the source of a quiz.
 *
 * A 6-12 lesson is generated at request time and stored as the exact document
 * that made the teacher's PDF: R2 `lp612/{template_version}/{lang}/{segment}.lp.json`
 * (the worker keeps it beside the PDF; Serving.docKeyFor names it). The K-5
 * LP-born quiz already reads a lesson plan through ONE picker —
 * lp-quiz-digest.carry() over the slide-script shape — so the 6-12 lane joins
 * it with a content ADAPTER, not a second prompt: lp_doc → the slide-script
 * fields carry() and the key check read.
 *
 * What must never cross: the lesson's own answers — the practice answers, the
 * exit ticket, the homework key, the exam bank and the model answers. They are
 * the 6-12 analogue of the K-5 exit MCQ (PLAN_R8 §8 row 27): a quiz that
 * reuses them measures who remembers the period. The key check may read them
 * (it holds keys against the lesson's answers); the author never does.
 *
 * The document read is EXACT-VERSION: the render row's (segment, lang,
 * template_version), never "the newest render of this lesson" — a quiz from a
 * newer document would ask about a page the teacher does not hold. A missing
 * object is "no source"; any other R2 failure throws so the queue retries,
 * never a permanent "could not open the lesson plan".
 */
jest.mock('../../bot/shared/storage/r2', () => ({ downloadFromR2: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { downloadFromR2 } = require('../../bot/shared/storage/r2');
const DOC = require('../lp612/__fixtures__/v9_gate_base.lp.json');
const Source = require('../../bot/shared/services/quiz/lp612-quiz-source');
const LpDigest = require('../../bot/shared/services/quiz/lp-quiz-digest.service');
const KeyCheck = require('../../bot/shared/services/quiz/lp-quiz-key-check.service');

const clone = (o) => JSON.parse(JSON.stringify(o));
const blocksOf = (type) => DOC.sections.flatMap((s) => s.blocks).filter((b) => b.type === type);

beforeEach(() => jest.clearAllMocks());

describe('toSlideScript — the 6-12 lesson document read as the slide script the LP quiz already reads', () => {
  const ss = Source.toSlideScript(DOC, { lang: 'en' });

  test('the objective, its level and the lesson it belongs to', () => {
    expect(ss.goal).toBe(DOC.objectives.outcome);
    expect(ss.sloFull).toBe(DOC.slo.text_verbatim);
    expect(ss.sloCode).toBe(DOC.slo.code);
    // FBISE K / U / A → the three levels the quiz pipeline speaks.
    expect(ss.bloom).toBe('apply');
    expect(ss.meta).toEqual(expect.objectContaining({
      grade: DOC.provenance.grade, topic: DOC.provenance.topic, chapterTitle: DOC.provenance.chapter_title, language: 'en',
    }));
    expect(ss.meta.sloDescriptions).toEqual(DOC.objectives.items.map((i) => i.text));
  });

  test('the worked example, the modelled one and the practice PROMPTS', () => {
    const [worked] = blocksOf('worked_example');
    const [faded] = blocksOf('faded_example');
    const [practice] = blocksOf('practice');
    expect(ss.iDo.worked).toEqual({ problem: worked.prompt, work: worked.steps, answer: worked.result || worked.answer || '' });
    expect(ss.weDo.modelled).toEqual(expect.objectContaining({ problem: faded.prompt, work: faded.steps }));
    expect(ss.youDo.problems.map((p) => p.prompt)).toEqual(practice.items.map((i) => i.q));
  });

  test('every mistake the plan warns about — the page-2 mistakes and the flagged watch-outs', () => {
    const slips = [ss.iDo.misconception, ...ss.misconceptions].map((m) => m.slip);
    DOC.page2.mistakes.forEach((m) => expect(slips).toContain(m.pupil_says));
    blocksOf('watch_out').filter((w) => w.misconception).forEach((w) => expect(slips).toContain(w.text));
  });

  test('the digest can write from it — and the author reads NONE of the lesson\'s answers', () => {
    expect(LpDigest.isUsable(ss)).toBe(true);
    const read = LpDigest.lessonExcerpts(ss) + LpDigest.buildLpDigestPrompt({ slideScript: ss, language: 'en', grade: '9', subject: 'maths' });
    const answers = [
      ...blocksOf('practice').flatMap((b) => b.items.map((i) => i.a)),
      ...DOC.sections.flatMap((s) => (s.exit_ticket || []).flatMap((x) => [x.q, x.a])),
      ...DOC.page2.homework_key.map((h) => h.answer),
      ...DOC.page2.exam_bank.mcq.map((m) => m.q),
      DOC.page2.exam_bank.srq.q,
      ...DOC.page2.model_answers.map((m) => m.answer),
    ].filter(Boolean);
    expect(answers.length).toBeGreaterThan(8);
    answers.forEach((a) => expect(read).not.toContain(a));
  });

  test('the key check DOES read the lesson\'s answers, as it does a K-5 plan\'s', () => {
    const { facts, mistakes } = KeyCheck.sourceAnswers(ss);
    const joined = facts.join('\n');
    expect(joined).toContain(DOC.page2.homework_key[0].answer.slice(0, 20));
    expect(mistakes.length).toBeGreaterThanOrEqual(DOC.page2.mistakes.length);
  });

  test('carry() still reads a K-5 slide script exactly as before (it has no top-level misconceptions list)', () => {
    const k5 = {
      meta: { grade: 2, subject: 'math', topic: 'Carrying' }, goal: 'Add with carrying', bloom: 'apply',
      iDo: { keyFact: 'Carry a ten', misconception: { slip: 'carries every column', why: 'habit', fix: 'check the ones' } },
      youDo: { problems: [{ prompt: '146 + 27' }] }, wrap: { keyFacts: ['ten ones make a ten'] },
    };
    const c = LpDigest.carry(k5);
    expect(c.misconception).toEqual({ slip: 'carries every column', why: 'habit', fix: 'check the ones' });
    expect(c.more_misconceptions).toEqual([]);
  });
});

describe('resolveLessonDoc — the exact document that made the teacher\'s PDF', () => {
  const LESSON = { segment_id: 'grade_9_mathematics.c01.p024-025', lang: 'en', template_version: 'v9.6' };

  test('reads lp612/{template_version}/{lang}/{segment}.lp.json and nothing else', async () => {
    downloadFromR2.mockResolvedValue(Buffer.from(JSON.stringify(DOC)));
    const doc = await Source.resolveLessonDoc(LESSON);
    expect(downloadFromR2).toHaveBeenCalledTimes(1);
    expect(downloadFromR2).toHaveBeenCalledWith('lp612/v9.6/en/grade_9_mathematics.c01.p024-025.lp.json');
    expect(doc.slo.code).toBe(DOC.slo.code);
  });

  test('no document for that exact version is "no source" — never a newer version\'s', async () => {
    downloadFromR2.mockRejectedValue(Object.assign(new Error('The specified key does not exist.'), { name: 'NoSuchKey' }));
    await expect(Source.resolveLessonDoc(LESSON)).resolves.toBeNull();
    expect(downloadFromR2).toHaveBeenCalledTimes(1);
  });

  test('a row without the version triple is "no source", with no R2 read', async () => {
    await expect(Source.resolveLessonDoc({ segment_id: LESSON.segment_id, lang: 'en' })).resolves.toBeNull();
    expect(downloadFromR2).not.toHaveBeenCalled();
  });

  test('any other R2 failure THROWS, so the job is redelivered instead of failing the quiz for good', async () => {
    downloadFromR2.mockRejectedValue(Object.assign(new Error('socket hang up'), { name: 'TimeoutError' }));
    await expect(Source.resolveLessonDoc(LESSON)).rejects.toThrow(/socket hang up/);
  });

  test('a stored object that is not a lesson is "no source" (the reader\'s own floor)', async () => {
    downloadFromR2.mockResolvedValue(Buffer.from(JSON.stringify({ error: 'nope' })));
    await expect(Source.resolveLessonDoc(LESSON)).resolves.toBeNull();
  });

  test('resolveSlideScript = the document, adapted — with the lesson\'s language', async () => {
    downloadFromR2.mockResolvedValue(Buffer.from(JSON.stringify(clone(DOC))));
    const ss = await Source.resolveSlideScript({ ...LESSON, lang: 'ur' });
    expect(downloadFromR2).toHaveBeenCalledWith('lp612/v9.6/ur/grade_9_mathematics.c01.p024-025.lp.json');
    expect(ss.goal).toBe(DOC.objectives.outcome);
    expect(ss.meta.language).toBe('ur');
  });
});
