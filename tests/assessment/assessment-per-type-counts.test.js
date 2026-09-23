/**
 * She names a count for EACH type she picked, instead of one total we divide up.
 *
 * Before this, the journey asked "how many questions" on QUESTIONS — one number,
 * before she had said which kinds she wanted — and then `withCounts()` spread
 * that number evenly over whatever she later ticked on TYPES. A teacher who
 * wanted 10 MCQs and 2 Short Questions asked for 12 and got 6 and 6. The split
 * was ours, never hers, and nothing on any screen admitted that.
 *
 * So the order flips and the total goes away:
 *
 *   QUESTIONS (content source + marks)  ─▶  TYPES (which kinds)  ─▶  COUNTS
 *
 * COUNTS draws one numbered box per type she ticked, in the order she ticked
 * them, and the paper's size becomes the sum of what she typed rather than a
 * number she has to reconcile against her own picks.
 *
 * `seen` keeps skipping both screens: its questions are lifted from the book and
 * already carry their own types, so planCounts() discards types on that path.
 * It still needs a size, so the count box stays on QUESTIONS for seen only.
 *
 * Operator feedback, 22 Sep 2026 (bd-60175).
 */
const fs = require('fs');
const path = require('path');

const FLOW = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../../docs/flows/assessment-gen-flow.json'), 'utf8'));
const screenById = Object.fromEntries(FLOW.screens.map((s) => [s.id, s]));

const MAX_TYPE_SLOTS = 8;

describe('the Flow has a COUNTS screen with one box per picked type', () => {
  test('COUNTS exists and is reachable from TYPES', () => {
    expect(screenById.COUNTS).toBeDefined();
    expect(FLOW.routing_model.TYPES).toContain('COUNTS');
  });

  test('COUNTS carries a numbered slot per type, each hideable', () => {
    const form = screenById.COUNTS.layout.children.find((c) => c.type === 'Form');
    for (let i = 1; i <= MAX_TYPE_SLOTS; i += 1) {
      const box = form.children.find((c) => c.name === `count_${i}`);
      expect(box).toBeDefined();
      // Label and visibility are server-driven: a Flow cannot react in-screen,
      // so a slot beyond her pick count must be able to disappear.
      expect(box.label).toBe(`\${data.label_${i}}`);
      expect(box.visible).toBe(`\${data.show_${i}}`);
      expect(box['input-type']).toBe('number');
    }
  });

  test('the COUNTS footer sends every slot back', () => {
    const form = screenById.COUNTS.layout.children.find((c) => c.type === 'Form');
    const footer = form.children.find((c) => c.type === 'Footer');
    for (let i = 1; i <= MAX_TYPE_SLOTS; i += 1) {
      expect(footer['on-click-action'].payload[`count_${i}`]).toBe(`\${form.count_${i}}`);
    }
  });

  test('TYPES no longer routes straight to CONFIRM', () => {
    // It must go through COUNTS now, or the counts screen is unreachable and
    // the old even-split is still what ships.
    expect(FLOW.routing_model.TYPES).not.toContain('CONFIRM');
  });

  test('the single total box is gone from QUESTIONS', () => {
    // `question_count` on QUESTIONS is the field this change removes: it asked
    // for a total before she had picked a single type.
    const form = screenById.QUESTIONS.layout.children.find((c) => c.type === 'Form');
    expect(form.children.find((c) => c.name === 'question_count')).toBeUndefined();
  });
});

describe('the endpoint collects a count per type', () => {
  const mockRedis = { get: jest.fn(), set: jest.fn(), delete: jest.fn() };
  // Enough of a query builder that a fall-through to CLASS renders instead of
  // throwing — a wrong screen should fail its assertion, not the whole file.
  const mockSupabase = {
    from: jest.fn(() => {
      const q = Promise.resolve({ data: [], error: null });
      q.select = () => q; q.eq = () => q; q.in = () => q;
      q.order = () => q; q.limit = () => q; q.single = () => q;
      return q;
    }),
  };
  jest.mock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
  jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
  jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.mock('../../bot/shared/services/queue', () => ({ queueJob: jest.fn() }));
  jest.mock('../../bot/shared/config/feature-flags', () => ({
    isAssessmentGeneratorEnabled: jest.fn().mockResolvedValue(true),
    isAssessmentEditingEnabled: jest.fn().mockResolvedValue(false),
    isAssessmentDocxEnabled: jest.fn().mockResolvedValue(false),
    ASSESSMENT_GENERATOR_KEY: 'a', ASSESSMENT_EDITING_KEY: 'b', ASSESSMENT_DOCX_KEY: 'c',
  }));

  const { handleAssessmentGenDataExchange: exchange, handleAssessmentGenBack: back } =
    require('../../bot/shared/routes/assessment-gen-endpoint');

  const TOKEN = 'u1:assessment-gen:1';
  const SESSION = {
    userId: 'u1', grade: 4, subject: 'science', chapterNumber: 3,
    pageRanges: '34-41', questionTypes: [],
  };
  const saved = () => mockRedis.set.mock.calls.at(-1)[1];

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis.get.mockResolvedValue({ ...SESSION });
    mockRedis.set.mockResolvedValue(true);
  });

  test('TYPES hands over to COUNTS, not CONFIRM', async () => {
    mockRedis.get.mockResolvedValue({ ...SESSION, contentSource: 'unseen' });
    const res = await exchange('u1', 'TYPES',
      { question_types: ['MCQs', 'Brief Answers'] }, TOKEN);
    expect(res.screen).toBe('COUNTS');
  });

  test('COUNTS labels one slot per picked type, in pick order, and hides the rest', async () => {
    mockRedis.get.mockResolvedValue({ ...SESSION, contentSource: 'unseen' });
    const res = await exchange('u1', 'TYPES',
      { question_types: ['MCQs', 'Brief Answers'] }, TOKEN);

    expect(res.data.show_1).toBe(true);
    expect(res.data.show_2).toBe(true);
    expect(res.data.label_1).toContain('MCQs');
    expect(res.data.label_2).toContain('Brief Answers');
    // A slot she does not need must be both hidden AND blank, or a stale label
    // from a previous pass renders under a box she cannot see.
    expect(res.data.show_3).toBe(false);
    expect(res.data.label_3).toBe('');
  });

  test('the counts she types are what reach the generator — no even split', async () => {
    // The whole point: 10 MCQs and 2 Short Questions must stay 10 and 2.
    mockRedis.get.mockResolvedValue({
      ...SESSION, contentSource: 'unseen', pickedTypes: ['MCQs', 'Brief Answers'],
    });
    const res = await exchange('u1', 'COUNTS', { count_1: '10', count_2: '2' }, TOKEN);
    expect(res.screen).toBe('CONFIRM');

    const state = saved();
    expect(state.questionTypes).toEqual([
      { id: 'MCQs', count: 10, category: 'objective' },
      { id: 'Brief Answers', count: 2, category: 'subjective' },
    ]);
    // The paper's size is now the sum of her boxes, not a number she typed.
    expect(state.questionCount).toBe(12);
  });

  test('a blank or junk box is refused on the screen, not silently defaulted', async () => {
    mockRedis.get.mockResolvedValue({
      ...SESSION, contentSource: 'unseen', pickedTypes: ['MCQs', 'Brief Answers'],
    });
    for (const bad of [{ count_1: '', count_2: '2' }, { count_1: 'abc', count_2: '2' },
      { count_1: '0', count_2: '2' }, { count_1: '-3', count_2: '2' }]) {
      const res = await exchange('u1', 'COUNTS', bad, TOKEN);
      expect(res.screen).toBe('COUNTS');
      expect(res.data.error).toBeTruthy();
    }
  });

  test('a paper bigger than the ceiling is refused, with the ceiling named', async () => {
    const QuestionTypes = require('../../bot/shared/services/assessment/question-types');
    mockRedis.get.mockResolvedValue({
      ...SESSION, contentSource: 'unseen', pickedTypes: ['MCQs', 'Brief Answers'],
    });
    const res = await exchange('u1', 'COUNTS',
      { count_1: String(QuestionTypes.MAX_QUESTIONS), count_2: '5' }, TOKEN);
    expect(res.screen).toBe('COUNTS');
    expect(res.data.error).toContain(String(QuestionTypes.MAX_QUESTIONS));
  });

  test('seen still skips both screens — its size is asked for on QUESTIONS', async () => {
    const res = await exchange('u1', 'QUESTIONS',
      { content_source: 'seen', question_count: '10' }, TOKEN);
    expect(res.screen).toBe('CONFIRM');
    expect(saved().questionCount).toBe(10);
  });

  test('unseen no longer needs a total on QUESTIONS to get through', async () => {
    // The box is gone from that screen, so an empty value must not bounce her.
    const res = await exchange('u1', 'QUESTIONS', { content_source: 'unseen' }, TOKEN);
    expect(res.screen).toBe('TYPES');
  });

  test('back from COUNTS lands on TYPES, the screen before it', async () => {
    mockRedis.get.mockResolvedValue({
      ...SESSION, contentSource: 'unseen', pickedTypes: ['MCQs'],
    });
    const res = await back('u1', 'COUNTS', TOKEN);
    expect(res.screen).toBe('TYPES');
  });

  test('CONFIRM recaps the per-type breakdown, so she can check it before paying for it', async () => {
    mockRedis.get.mockResolvedValue({
      ...SESSION, contentSource: 'unseen', pickedTypes: ['MCQs', 'Brief Answers'],
    });
    const res = await exchange('u1', 'COUNTS', { count_1: '10', count_2: '2' }, TOKEN);
    expect(res.data.recap).toContain('10 MCQs');
    expect(res.data.recap).toContain('2 Brief Answers');
  });
});

describe('the counts survive the trip to the model', () => {
  const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');

  const TYPES = [
    { id: 'MCQs', count: 10, category: 'objective' },
    { id: 'Brief Answers', count: 2, category: 'subjective' },
  ];

  test('planCounts keeps an uneven unseen split exactly as she set it', () => {
    const plan = Gen.planCounts({ contentSource: 'unseen', questionCount: 12, questionTypes: TYPES });
    expect(plan.questionTypes).toEqual(TYPES);
    expect(plan.total).toBe(12);
  });

  test('the prompt asks for her numbers, not an average of them', () => {
    const prompt = Gen.buildUserPrompt({
      grade: 4, subject: 'science', pageContent: 'x', pageReference: '34-41',
      contentSource: 'unseen', questionCount: 12, questionTypes: TYPES,
    });
    expect(prompt).toContain('10 MCQs');
    expect(prompt).toContain('2 Brief Answers');
    expect(prompt).not.toContain('6 MCQs');
  });
});
