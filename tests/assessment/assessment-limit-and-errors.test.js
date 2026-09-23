/**
 * A paper may hold up to 50 questions, and a refusal is one she can SEE.
 *
 * Operator, 23 Sep 2026, after a sandbox run: raise the ceiling from 25 to 50,
 * and "when you hit the limit, no error is displayed to the user so they can't
 * even tell what is happening". The logs from that run show Continue tapped
 * twice a second apart on both the Seen screen and the per-type screen — she
 * saw nothing change, so she tapped again.
 *
 * The refusal text used to sit in one TextBody at the TOP of the screen, under
 * the heading — furthest from the box she typed in and the button she pressed.
 * It now lands in two places she is already looking:
 *   · in red under the offending box, through the Form's `error-messages`
 *     map (box name → message). A TextInput-level `error-message` is what we
 *     tried first; Meta's validator rejects it in this Flow version
 *     ("Property 'error-message' is not allowed in 'TextInput'") and the
 *     failed upload left the sandbox Flow in DRAFT until it was rolled back.
 *     The Form-level map was validated against Meta on a throwaway Flow;
 *   · in a line directly above Continue, for refusals that belong to no single
 *     box (the Seen + Unseen total).
 * And every refusal is logged with the text we sent, so the next "nothing
 * happened" can be answered from the logs instead of guessed at.
 */
const fs = require('fs');
const path = require('path');

const FLOW = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../../docs/flows/assessment-gen-flow.json'), 'utf8'));
const byId = Object.fromEntries(FLOW.screens.map((s) => [s.id, s]));
const formOf = (id) => byId[id].layout.children.find((c) => c.type === 'Form').children;

const QuestionTypes = require('../../bot/shared/services/assessment/question-types');

describe('the ceiling is 50', () => {
  test('50 is allowed and 51 is refused, naming 50', () => {
    expect(QuestionTypes.MAX_QUESTIONS).toBe(50);
    expect(QuestionTypes.parseQuestionCount('50')).toEqual({ ok: true, count: 50 });
    const r = QuestionTypes.parseQuestionCount('51');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/50/);
  });

  test('the marks typo-guard stays above any real paper: 50 questions × 20 marks', () => {
    expect(QuestionTypes.MAX_TOTAL_MARKS).toBeGreaterThanOrEqual(1000);
    expect(QuestionTypes.parseTotalMarks('1000').ok).toBe(true);
  });
});

describe('the Flow shows a refusal where she is looking', () => {
  const lastBeforeFooter = (id) => {
    const kids = formOf(id);
    return kids[kids.findIndex((c) => c.type === 'Footer') - 1];
  };

  const formNode = (id) => byId[id].layout.children.find((c) => c.type === 'Form');

  test.each(['SEEN_COUNT', 'COUNTS'])('%s marks a box through the Form-level error-messages map', (id) => {
    expect(formNode(id)['error-messages']).toBe('${data.error_messages}');
    expect(byId[id].data.error_messages.type).toBe('object');
  });

  test('no TextInput carries error-message — Meta rejects it in this version', () => {
    for (const s of FLOW.screens) {
      const form = s.layout.children.find((c) => c.type === 'Form');
      for (const c of (form ? form.children : [])) {
        if (c.type === 'TextInput') expect(c).not.toHaveProperty('error-message');
      }
    }
  });

  test.each(['SEEN_COUNT', 'COUNTS'])('%s repeats the refusal directly above Continue', (id) => {
    const line = lastBeforeFooter(id);
    expect(line.type).toBe('TextBody');
    expect(line.text).toBe('${data.error}');
    expect(line.visible).toBe('${data.has_error}');
  });
});

describe('the endpoint', () => {
  const mockRedis = { get: jest.fn(), set: jest.fn(), delete: jest.fn() };
  const mockLog = jest.fn();
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
  jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: mockLog }));
  jest.mock('../../bot/shared/services/queue', () => ({ queueJob: jest.fn() }));
  jest.mock('../../bot/shared/config/feature-flags', () => ({
    isAssessmentGeneratorEnabled: jest.fn().mockResolvedValue(true),
    isAssessmentEditingEnabled: jest.fn().mockResolvedValue(false),
    isAssessmentDocxEnabled: jest.fn().mockResolvedValue(false),
    ASSESSMENT_GENERATOR_KEY: 'a', ASSESSMENT_EDITING_KEY: 'b', ASSESSMENT_DOCX_KEY: 'c',
  }));

  const { handleAssessmentGenDataExchange: exchange } =
    require('../../bot/shared/routes/assessment-gen-endpoint');

  const TOKEN = 'u1:assessment-gen:1';
  let store;
  beforeEach(() => {
    jest.clearAllMocks();
    store = { userId: 'u1', grade: 4, subject: 'science', chapterNumber: 3, pageRanges: '34-41' };
    mockRedis.get.mockImplementation(async () => ({ ...store }));
    mockRedis.set.mockImplementation(async (_k, v) => { store = { ...v }; return true; });
  });

  const refusalLogged = (screenId) => mockLog.mock.calls.some(
    ([msg, meta]) => msg === '[assessment-flow] input refused' && meta && meta.screen === screenId && meta.message,
  );

  test('a fresh screen carries empty field errors, so no red text shows', async () => {
    const s = await exchange('u1', 'QUESTIONS', { content_source: 'seen' }, TOKEN);
    expect(s.data.error_messages).toEqual({});
    await exchange('u1', 'QUESTIONS', { content_source: 'unseen' }, TOKEN);
    const t = await exchange('u1', 'TYPES', { question_types: ['MCQs', 'Brief Answers'] }, TOKEN);
    expect(t.data.error_messages).toEqual({});
  });

  test('Seen over the ceiling: the message is under the box, above Continue, and logged', async () => {
    await exchange('u1', 'QUESTIONS', { content_source: 'seen' }, TOKEN);
    const r = await exchange('u1', 'SEEN_COUNT', { seen_count: '51' }, TOKEN);
    expect(r.screen).toBe('SEEN_COUNT');
    expect(r.data.error_messages.seen_count).toMatch(/50/);
    expect(r.data.error).toMatch(/50/);
    expect(r.data.has_error).toBe(true);
    expect(refusalLogged('SEEN_COUNT')).toBe(true);
  });

  test('a bad per-type box is marked on THAT box only', async () => {
    await exchange('u1', 'QUESTIONS', { content_source: 'unseen' }, TOKEN);
    await exchange('u1', 'TYPES', { question_types: ['MCQs', 'Brief Answers'] }, TOKEN);
    const r = await exchange('u1', 'COUNTS', { count_1: '10', count_2: '60' }, TOKEN);
    expect(r.screen).toBe('COUNTS');
    expect(Object.keys(r.data.error_messages)).toEqual(['count_2']);
    expect(r.data.error_messages.count_2).toMatch(/50/);
    expect(r.data.error).toBeTruthy();
    expect(refusalLogged('COUNTS')).toBe(true);
  });

  test('Seen + Unseen over 50 is shown above Continue, naming both parts', async () => {
    await exchange('u1', 'QUESTIONS', { content_source: 'both' }, TOKEN);
    await exchange('u1', 'SEEN_COUNT', { seen_count: '30' }, TOKEN);
    await exchange('u1', 'TYPES', { question_types: ['MCQs', 'Brief Answers'] }, TOKEN);
    const r = await exchange('u1', 'COUNTS', { count_1: '15', count_2: '10' }, TOKEN);
    expect(r.screen).toBe('COUNTS');
    expect(r.data.error).toMatch(/55/);
    expect(r.data.error).toMatch(/30 Seen/);
    expect(r.data.error).toMatch(/50/);
    expect(r.data.has_error).toBe(true);
    // A total belongs to no one box: nothing is marked red.
    expect(r.data.error_messages).toEqual({});
  });

  test('every response carries only data the published screen declares', async () => {
    // An undeclared key is what the rejected 7.3 attempt would have left the
    // deployed code sending to a 7.2 device. Pin the contract: every data key
    // the endpoint returns for these screens is declared in the Flow JSON.
    await exchange('u1', 'QUESTIONS', { content_source: 'both' }, TOKEN);
    const seen = await exchange('u1', 'SEEN_COUNT', { seen_count: '60' }, TOKEN);
    await exchange('u1', 'SEEN_COUNT', { seen_count: '5' }, TOKEN);
    const counts = await exchange('u1', 'TYPES', { question_types: ['MCQs'] }, TOKEN);
    for (const res of [seen, counts]) {
      const declared = Object.keys(byId[res.screen].data);
      for (const k of Object.keys(res.data)) expect([res.screen, k, declared.includes(k)]).toEqual([res.screen, k, true]);
    }
  });

  test('exactly 50 across Seen and Unseen is accepted', async () => {
    await exchange('u1', 'QUESTIONS', { content_source: 'both' }, TOKEN);
    await exchange('u1', 'SEEN_COUNT', { seen_count: '30' }, TOKEN);
    await exchange('u1', 'TYPES', { question_types: ['MCQs', 'Brief Answers'] }, TOKEN);
    const r = await exchange('u1', 'COUNTS', { count_1: '15', count_2: '5' }, TOKEN);
    expect(r.screen).toBe('CONFIRM');
    expect(store.questionCount).toBe(50);
  });
});
