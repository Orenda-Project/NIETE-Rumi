/**
 * bd-gr4fy.15 — the coach's debrief guide and feedback card are their own job, not coaching.completeJson.
 *
 * Every consumer of GPT5MiniService.completeJson went out under one label, coaching.completeJson, so one
 * settings entry moved them all. Measured offline on real sessions (7 Oct 2026) they want different models:
 * the debrief guide and the coach feedback card read better on Sonnet 5 (no guide cut off at the limit,
 * gender-neutral Urdu, the harm rule held), while the teacher's debrief notes (both Claude models put a
 * commitment in the teacher's mouth) and observe2 moments (Sonnet ran into the 180 s timeout) are right
 * where they are. Neither group could be moved without dragging the other.
 *
 * Pinned here: the guide, the feedback card and its repair run as coaching.observeDebrief; a completeJson
 * call that names no job stays coaching.completeJson; an override of either moves its own calls only; with
 * no override all of them keep today's model. Executed for real: only the network (globalThis.fetch) and
 * the settings-table read are replaced; the debrief service, the helper and the llm-client seam all run.
 */

const REAL_FETCH = globalThis.fetch;
const SCRUBBED = [
  'REDIS_URL', 'WHATSAPP_TOKEN', 'WHATSAPP_ACCESS_TOKEN', 'PHONE_NUMBER_ID', 'E2E_CASSETTE',
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_BASE_URL', 'LLM_PROVIDER', 'LLM_MODEL',
  'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'LLM_JOB_MODELS', 'ANTHROPIC_API_KEY',
];

// The settings table is read once, and holds nothing: overrides then come from LLM_JOB_MODELS alone.
jest.mock('../../bot/shared/config/supabase', () => ({
  from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }),
}));

const TODAY = 'openai/gpt-5-mini-2025-08-07';
const MOVED = 'openai/gpt-4o';

let sent; // every vendor completion: which consumer's prompt, and which model it went to
const saved = {};

/** Which consumer a prompt belongs to. The guide's prompt is the debrief service's own. */
function consumerOf(prompt) {
  if (prompt.includes('rejected by a strict validator')) return 'repair';
  if (prompt.includes('FEEDBACK-PROMPT')) return 'feedback';
  if (prompt.includes('NOTES-PROMPT')) return 'notes';
  return 'guide';
}

beforeEach(() => {
  sent = [];
  for (const k of SCRUBBED) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.OPENAI_API_KEY = 'test-openai';
  process.env.OPENROUTER_API_KEY = 'test-openrouter';
  // config/supabase is mocked above; these only satisfy code that checks the variables exist.
  process.env.SUPABASE_URL = 'http://127.0.0.1:1/observe-debrief-split-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-not-a-key';

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input && input.url ? input.url : input);
    let body = null;
    try { body = init.body ? JSON.parse(init.body) : null; } catch (_) { body = init.body; }
    const json = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });
    if (/\/chat\/completions/.test(url)) {
      const prompt = ((body && body.messages) || []).map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      sent.push({ consumer: consumerOf(prompt), model: body && body.model });
      return json({
        id: 'chatcmpl-test', object: 'chat.completion', created: 0, model: (body && body.model) || 'x',
        // Valid JSON of no use to any validator: the guide falls back to its canned text, and the feedback
        // card is repaired once and then rejected. Each request is still made, which is what is checked.
        choices: [{ index: 0, message: { role: 'assistant', content: '{}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
      });
    }
    return json({ ok: true });
  };
});

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  for (const k of SCRUBBED) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

/** One guide, one feedback card (which is repaired once), and one completeJson call naming no job. */
async function run(jobModels) {
  jest.resetModules();
  if (jobModels) process.env.LLM_JOB_MODELS = JSON.stringify(jobModels);
  const sl = require('../../bot/shared/utils/structured-logger');
  await require('../../bot/shared/config/model-settings').refresh();
  const debrief = require('../../bot/shared/services/observe/observe-debrief.service');
  const GPT5MiniService = require('../../bot/shared/services/gpt5-mini.service');

  await debrief.buildDebriefGuide({ id: 'session-1', user_id: 'user-1', analysis_data: { framework: 'fico' } }, 'en');
  await debrief.coachFeedbackWithRepair('FEEDBACK-PROMPT: write the card.', 'session-1').catch(() => {});
  // How the teacher's debrief notes, observe2 moments and the remark narrative call it: no job named.
  await GPT5MiniService.completeJson('NOTES-PROMPT: write the notes.', { maxTokens: 2000, label: 'observeDebriefNotes' });

  const cost = sl.logger.info.mock.calls.map((c) => c[0]).filter((e) => e && e.event === 'api.cost.incurred');
  const models = (consumer) => sent.filter((x) => x.consumer === consumer).map((x) => x.model);
  return { cost, models };
}

describe('the coach\'s debrief guide and feedback card are their own job (bd-gr4fy.15)', () => {
  test('each call is recorded under its own job, and with no override all keep today\'s model', async () => {
    const r = await run(null);
    expect(r.models('guide')).toEqual([TODAY]);
    expect(r.models('feedback')).toEqual([TODAY]);
    expect(r.models('repair')).toEqual([TODAY]);
    expect(r.models('notes')).toEqual([TODAY]);
    expect(r.cost.map((e) => e.job)).toEqual([
      'coaching.observeDebrief', 'coaching.observeDebrief', 'coaching.observeDebrief', 'coaching.completeJson',
    ]);
  });

  test('an override of coaching.observeDebrief moves the guide, the card and its repair, and nothing else', async () => {
    const r = await run({ 'coaching.observeDebrief': MOVED });
    expect(r.models('guide')).toEqual([MOVED]);
    expect(r.models('feedback')).toEqual([MOVED]);
    expect(r.models('repair')).toEqual([MOVED]);
    expect(r.models('notes')).toEqual([TODAY]);
  });

  test('an override of coaching.completeJson no longer moves the guide or the card', async () => {
    const r = await run({ 'coaching.completeJson': MOVED });
    expect(r.models('guide')).toEqual([TODAY]);
    expect(r.models('feedback')).toEqual([TODAY]);
    expect(r.models('repair')).toEqual([TODAY]);
    expect(r.models('notes')).toEqual([MOVED]);
  });

  test('the registry holds the new job like completeJson: same model, its site, its reply checked as its caller parses it', () => {
    jest.resetModules();
    const { JOBS, JSON_REPAIRED_BY_CALLER, modelFor } = require('../../bot/shared/config/model-registry');
    expect(JOBS['coaching.observeDebrief']).toEqual(expect.objectContaining({
      env: null, default: JOBS['coaching.completeJson'].default, site: 'shared/services/observe/observe-debrief.service.js',
    }));
    expect(modelFor('coaching.observeDebrief')).toBe('gpt-5-mini-2025-08-07');
    expect(JSON_REPAIRED_BY_CALLER['coaching.observeDebrief']).toBe(JSON_REPAIRED_BY_CALLER['coaching.completeJson']);
  });
});
