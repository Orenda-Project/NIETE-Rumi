/**
 * Question-type selection is decided by the CATEGORY, not by an opt-in.
 *
 * It used to be a tick-box on the QUESTIONS screen: "Choose question types
 * myself". The endpoint routed to TYPES if and only if that box was ticked, and
 * never looked at `content_source` at all. Two things were wrong with that.
 *
 *   seen  — the types are already fixed by the book questions she picks. Asking
 *           her to choose them is a question with no answer that matters, and
 *           `planCounts()` THREW AWAY whatever she chose (it returns
 *           `questionTypes: []` for seen). She could tick the box, pick four
 *           types, and have all four silently discarded.
 *   unseen / both — there is no book question to inherit a type from, so the
 *           generator needs the types. Behind an opt-in she is unlikely to tick,
 *           the common path fell through to `defaultMix()` — our guess, not her
 *           paper.
 *
 * So: no opt-in at all. `seen` skips TYPES; `unseen` and `both` go through it,
 * and TYPES already refuses an empty selection.
 *
 * Reported by Hashir, NIETE partner bug sheet row 3 (bd-60100).
 */
const fs = require('fs');
const path = require('path');

const FLOW = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../../docs/flows/assessment-gen-flow.json'), 'utf8'));
const screenById = Object.fromEntries(FLOW.screens.map((s) => [s.id, s]));

describe('the Flow no longer offers the opt-in', () => {
  test('the QUESTIONS screen has no pick_types component', () => {
    // Asserted over the whole screen rather than a known path, because an
    // OptIn can be nested anywhere inside the Form.
    const components = [];
    (function walk(node) {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== 'object') return;
      if (node.name) components.push(node.name);
      Object.values(node).forEach(walk);
    })(screenById.QUESTIONS);
    expect(components).not.toContain('pick_types');
  });

  test('the QUESTIONS footer does not send pick_types back', () => {
    // A payload key for a component that no longer exists interpolates to
    // nothing, which is the shape that has broken renders here before.
    expect(JSON.stringify(screenById.QUESTIONS)).not.toContain('pick_types');
  });

  test('content_source still offers all three categories', () => {
    const radio = screenById.QUESTIONS.layout.children[0].children
      .find((c) => c.name === 'content_source');
    expect(radio['data-source'].map((o) => o.id)).toEqual(['seen', 'unseen', 'both']);
    expect(radio.required).toBe(true);
  });

  test('TYPES still requires at least one selection', () => {
    const group = screenById.TYPES.layout.children[0].children
      .find((c) => c.name === 'question_types');
    expect(group.required).toBe(true);
  });
});

describe('the endpoint routes on the category', () => {
  const mockRedis = { get: jest.fn(), set: jest.fn(), delete: jest.fn() };
  const mockSupabase = { from: jest.fn() };
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

  const SESSION = { userId: 'u1', grade: 4, subject: 'science', chapterNumber: 3,
    pageRanges: '34-41', questionTypes: [] };

  beforeEach(() => {
    mockRedis.get.mockResolvedValue({ ...SESSION });
    mockRedis.set.mockResolvedValue(true);
  });

  test('seen goes STRAIGHT to CONFIRM — the book questions carry their own types', async () => {
    const res = await exchange('u1', 'QUESTIONS',
      { content_source: 'seen', question_count: '10' }, 'u1:assessment-gen:1');
    expect(res.screen).toBe('CONFIRM');
  });

  test('unseen goes to TYPES — mandatory, with no opt-in to tick', async () => {
    const res = await exchange('u1', 'QUESTIONS',
      { content_source: 'unseen', question_count: '10' }, 'u1:assessment-gen:1');
    expect(res.screen).toBe('TYPES');
    expect(Array.isArray(res.data.types)).toBe(true);
    expect(res.data.types.length).toBeGreaterThan(0);
  });

  test('both goes to TYPES too — half the paper is new questions', async () => {
    const res = await exchange('u1', 'QUESTIONS',
      { content_source: 'both', question_count: '10' }, 'u1:assessment-gen:1');
    expect(res.screen).toBe('TYPES');
  });

  test('an unticked opt-in no longer sends her past the types she must choose', async () => {
    // The exact payload the old Flow sent. Even if a client somewhere is still
    // on the old version, the category is what decides.
    const res = await exchange('u1', 'QUESTIONS',
      { content_source: 'unseen', question_count: '10', pick_types: false }, 'u1:assessment-gen:1');
    expect(res.screen).toBe('TYPES');
  });

  test('a ticked opt-in cannot conjure a TYPES screen on the seen path', async () => {
    // It used to, and then planCounts() discarded every type she chose.
    const res = await exchange('u1', 'QUESTIONS',
      { content_source: 'seen', question_count: '10', pick_types: true }, 'u1:assessment-gen:1');
    expect(res.screen).toBe('CONFIRM');
  });

  test('TYPES still refuses an empty selection on the way to CONFIRM', async () => {
    const res = await exchange('u1', 'TYPES', { question_types: [] }, 'u1:assessment-gen:1');
    expect(res.screen).toBe('TYPES');
    expect(res.data.error).toMatch(/at least one/i);
  });

  test('the types she picks are written to the session, not dropped', async () => {
    mockRedis.get.mockResolvedValue({ ...SESSION, contentSource: 'unseen', questionCount: 10 });
    const res = await exchange('u1', 'TYPES',
      { question_types: ['MCQs'] }, 'u1:assessment-gen:1');
    // bd-60175: COUNTS now sits between TYPES and CONFIRM — she names how many
    // of each type next. What this test guards is unchanged: the picks reach
    // the session rather than being dropped on the way.
    expect(res.screen).toBe('COUNTS');
    const saved = mockRedis.set.mock.calls.at(-1)[1];
    expect(saved.pickedTypes).toEqual(['MCQs']);
  });

  test('back from TYPES lands on QUESTIONS — the screen before it on the unseen path', async () => {
    mockRedis.get.mockResolvedValue({ ...SESSION, contentSource: 'unseen' });
    const res = await back('u1', 'TYPES', 'u1:assessment-gen:1');
    expect(res.screen).toBe('QUESTIONS');
  });

  test('back from CONFIRM lands on QUESTIONS for seen, which never saw TYPES', async () => {
    // bd-60175: on the current Flow seen names its size on COUNTS, so COUNTS is
    // the screen before CONFIRM. A client still on the old published Flow
    // (legacyCounts) never had COUNTS and still goes back to QUESTIONS.
    mockRedis.get.mockResolvedValue({ ...SESSION, contentSource: 'seen', legacyCounts: true });
    const legacy = await back('u1', 'CONFIRM', 'u1:assessment-gen:1');
    expect(legacy.screen).toBe('QUESTIONS');

    // Current Flow: seen reaches CONFIRM through its own Seen screen.
    mockRedis.get.mockResolvedValue({ ...SESSION, contentSource: 'seen' });
    const current = await back('u1', 'CONFIRM', 'u1:assessment-gen:1');
    expect(current.screen).toBe('SEEN_COUNT');
  });
});
