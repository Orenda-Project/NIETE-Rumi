/**
 * bd-gr4fy.5.7 — a moved vision.analyse answer is checked the way its caller parses it.
 *
 * The coaching photo pass asks for JSON (`response_format: json_object`), and the direct Anthropic lane does not
 * enforce it: it is a sentence in the prompt there, and Sonnet 5 runs without a temperature. So now and then the
 * reading comes back with a JSON slip: an unescaped quote inside a string, a raw newline, a trailing comma, a //
 * comment, a missing comma, usually inside a ```json fence. The seam refused every such answer as not_json and
 * asked gpt-4.1-mini again (7 of 365 photos after the 2026-10-08 release, 2 to 9 seconds each), although the caller,
 * photo-analysis parseJsonObject, parses exactly that: JSON.parse, then jsonrepair. Listing the job in
 * JSON_REPAIRED_BY_CALLER as 'whole' makes the seam accept what the caller turns into an object, untouched, and
 * still fall back on what the caller would not: prose, two objects, an array, an answer cut off at the limit.
 *
 * Also pinned: a not_json fallback says what the answer LOOKED like (counts and flags, never a word of it), so the
 * next such fallback can be diagnosed from the logs alone.
 *
 * Executed for real: photo-analysis, vision.service, the settings module, llm-client and the direct-lane facade.
 * Only the network edges are replaced: both model SDKs and the Supabase client the settings are read through.
 * Every reading below is synthetic.
 */
const mockState = { or: [], an: [], events: [], rows: [], anReply: null, anStop: 'end_turn', orReply: null };

jest.mock('openai', () => function OpenAI() {
  return { chat: { completions: { create: async (params) => {
    mockState.or.push(params);
    return { choices: [{ index: 0, message: { role: 'assistant', content: mockState.orReply }, finish_reason: 'stop' }], usage: { cost: 0.001 } };
  } } } };
});
jest.mock('@anthropic-ai/sdk', () => function Anthropic() {
  return { messages: { create: async (req) => {
    mockState.an.push(req);
    return {
      id: 'msg_1', model: req.model, stop_reason: mockState.anStop,
      content: [{ type: 'text', text: mockState.anReply }], usage: { input_tokens: 5, output_tokens: 3 },
    };
  } } };
});
jest.mock('../../bot/shared/utils/model-cost', () => ({ recordModelCost: () => {} }));
jest.mock('../../bot/shared/config/supabase', () => ({
  from: () => ({ select: () => ({ in: async () => ({ data: mockState.rows, error: null }) }) }),
}));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (name, data) => mockState.events.push({ name, data }),
  getCurrentCorrelationId: () => 'corr-1',
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: () => {} }));
jest.mock('../../bot/shared/services/e2e-cassette', () => ({ mode: () => 'off', wrapChatCompletions: () => {} }), { virtual: true });

const OLD_ENV = { ...process.env };
const CLAUDE = 'anthropic-direct/claude-sonnet-5';

/** A clean, synthetic reading of a board photo. */
const READING = {
  kind: 'board',
  description: 'The board shows the heading Fractions and two shapes.',
  students: '',
  learning_materials: ['chalk', 'textbook'],
  student_work: '',
  drawings: 'a circle cut into two equal parts',
  visible_text: 'Fractions\n1/2 and 1/4',
};
const fence = (s) => `\`\`\`json\n${s}\n\`\`\``;
const pretty = (obj) => JSON.stringify(obj, null, 2);
const withDescription = (d) => ({ ...READING, description: d });

async function read(anReply, { stop = 'end_turn' } = {}) {
  jest.resetModules();
  for (const k of ['ANTHROPIC_API_KEY', 'LLM_PROVIDER', 'LLM_JOB_MODELS', 'LLM_FALLBACK_OFF', 'VISION_MODEL']) delete process.env[k];
  Object.assign(process.env, {
    OPENROUTER_API_KEY: 'or-key', ANTHROPIC_API_KEY: 'test-key',
    SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test',
  });
  Object.assign(mockState, { or: [], an: [], events: [], anReply, anStop: stop, orReply: JSON.stringify(READING) });
  mockState.rows = [{ key: 'llm_per_job', value: { 'vision.analyse': CLAUDE } }];
  // eslint-disable-next-line global-require
  await require('../../bot/shared/config/model-settings').refresh();
  // eslint-disable-next-line global-require
  const { analyzeClassroomPhotoV2 } = require('../../bot/shared/services/coaching/classroom-photo/photo-analysis.service');
  const result = await analyzeClassroomPhotoV2(Buffer.from('fake-jpeg'), 'image/jpeg', { coachingSessionId: 's1', photo: 1 });
  const fallbacks = mockState.events.filter((e) => e.name === 'llm.job_override_fallback');
  return { result, fallbacks, askedClaude: mockState.an.length, askedBehind: mockState.or.length };
}

afterEach(() => { process.env = { ...OLD_ENV }; });

describe('vision.analyse: an answer its caller repairs is accepted, untouched (bd-gr4fy.5.7)', () => {
  test.each([
    ['an unescaped quote inside a string', withDescription('The board shows the heading "Fractions" and two shapes.'),
      (clean) => fence(pretty(clean).replace('\\"Fractions\\"', '"Fractions"'))],
    ['a raw newline inside a string', withDescription('The board shows the heading Fractions\nand two shapes.'),
      (clean) => fence(pretty(clean).replace('Fractions\\nand', 'Fractions\nand'))],
    ['a trailing comma', READING, (clean) => fence(pretty(clean).replace(/\n}$/, ',\n}'))],
    ['a // comment', READING, (clean) => fence(pretty(clean).replace('"kind": "board",', '"kind": "board", // what the photo mainly shows'))],
    ['a missing comma', READING, (clean) => fence(pretty(clean).replace('"kind": "board",', '"kind": "board"'))],
  ])('%s: no fallback, and the reading equals the clean one', async (_what, clean, slip) => {
    const control = await read(JSON.stringify(clean));
    expect(control.fallbacks).toEqual([]);
    expect(control.result.ok).toBe(true);

    const malformed = slip(clean);
    expect(() => JSON.parse(malformed)).toThrow(); // the slip is real: a strict parse refuses it
    const r = await read(malformed);
    expect(r.fallbacks).toEqual([]);
    expect(r.askedClaude).toBe(1);
    expect(r.askedBehind).toBe(0);
    expect(r.result).toEqual(control.result);
  });

  test('the quote survives into the reading the scorers get', async () => {
    const clean = withDescription('The board shows the heading "Fractions" and two shapes.');
    const r = await read(fence(pretty(clean).replace('\\"Fractions\\"', '"Fractions"')));
    expect(r.result.description).toContain('"Fractions"');
  });

  test.each([
    ['prose only', 'The board shows the heading Fractions and two shapes.', 'not_json'],
    ['two objects', `${JSON.stringify(READING)}\n${JSON.stringify(withDescription('Another.'))}`, 'not_json'],
    ['a top-level array', JSON.stringify([READING]), 'not_json'],
  ])('%s still falls back to the job\'s own model', async (_what, reply, kind) => {
    const r = await read(reply);
    expect(r.fallbacks).toHaveLength(1);
    expect(r.fallbacks[0].data.kind).toBe(kind);
    expect(r.askedBehind).toBe(1);
    expect(r.result.ok).toBe(true); // the job's own model answered
  });

  test('an answer cut off at the limit still falls back, as cut_off', async () => {
    const r = await read(fence(pretty(READING)).slice(0, 120), { stop: 'max_tokens' });
    expect(r.fallbacks).toHaveLength(1);
    expect(r.fallbacks[0].data.kind).toBe('cut_off');
    expect(r.askedBehind).toBe(1);
  });

  test('the map holds the job like the other caller-repaired jobs', () => {
    jest.resetModules();
    // eslint-disable-next-line global-require
    const { JSON_REPAIRED_BY_CALLER } = require('../../bot/shared/config/model-registry');
    expect(JSON_REPAIRED_BY_CALLER['vision.analyse']).toBe('whole');
  });
});

describe('a not_json fallback records the answer\'s shape, never its words (bd-gr4fy.5.7)', () => {
  test('counts and flags only', async () => {
    const prose = 'Sorry, here is the reading: the board shows Fractionsworthy shapes {and more';
    const r = await read(prose);
    expect(r.fallbacks).toHaveLength(1);
    const { replyShape } = r.fallbacks[0].data;
    expect(replyShape).toEqual({
      length: prose.length, fenced: false, startsWith: 'text', endsWith: 'text',
      openBraces: 1, closeBraces: 0, quotes: 0, newlines: 0,
    });
    expect(JSON.stringify(r.fallbacks[0].data)).not.toMatch(/Fractionsworthy|Sorry|board/);
  });

  test('a fallback of another kind carries no shape', async () => {
    const r = await read(fence(pretty(READING)).slice(0, 120), { stop: 'max_tokens' });
    expect(r.fallbacks[0].data.kind).toBe('cut_off');
    expect(r.fallbacks[0].data.replyShape).toBeUndefined();
  });
});
