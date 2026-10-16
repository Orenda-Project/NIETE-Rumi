/**
 * bd-08qvls.1 — the /observe2 moments call and its label check are their own job, observe2.moments.
 *
 * Both went out under coaching.completeJson, the job every GPT5MiniService.completeJson consumer that names
 * none shares, with the teacher's /observe debrief notes and the remark narrative among them. The model eval
 * (bd-08qvls, 16 Oct 2026, 26 prod transcripts, two judges) found the moments far better on Claude Sonnet 5.5,
 * and the other two were never measured there, so moving one must not drag the others.
 *
 * Pinned here, executed for real (the moments module, the quote and label checks, completeJson, the llm-client
 * seam and its settings read; only the network (globalThis.fetch), the database (in memory, its app_settings
 * row included) and WhatsApp are replaced):
 *   - with no override, both calls go out as observe2.moments on today's model with today's request;
 *   - the app_settings llm_per_job row moves observe2.moments, and the debrief notes and the remark narrative
 *     stay on coaching.completeJson and today's model;
 *   - a move of coaching.completeJson no longer moves the moments.
 */

const { createFakeSupabase } = require('../observe2/helpers/fake-supabase');

const REAL_FETCH = globalThis.fetch;
const SCRUBBED = [
  'REDIS_URL', 'WHATSAPP_TOKEN', 'WHATSAPP_ACCESS_TOKEN', 'PHONE_NUMBER_ID', 'E2E_CASSETTE',
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_BASE_URL', 'LLM_PROVIDER', 'LLM_MODEL',
  'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'LLM_JOB_MODELS', 'ANTHROPIC_API_KEY', 'OBSERVE2_CHECK_FLOW_ID',
];

let mockFake;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendFlow: jest.fn(() => Promise.resolve(false)),
}));

const TODAY = 'openai/gpt-5-mini-2025-08-07';
const MOVED = 'openai/gpt-4o';

const TRANSCRIPT = [
  '[00:40] Teacher (EN): Why do plants need sunlight? What do you think?',
  '[00:52] Student (EN): Because they make their food from it.',
  '[05:10] Teacher (EN): No, that is wrong. Who else can tell me?',
].join('\n\n');
const MOMENTS = {
  moments: [
    { moment: 'ask', type: 'open_q_one', minute: '00:40', quote: 'Why do plants need sunlight? What do you think? — Because they make their food from it.', why: 'An open question a child answered with a reason.' },
    { moment: 'wrong', type: 'wrong_ignored', minute: '05:10', quote: 'No, that is wrong. Who else can tell me?', why: 'A wrong answer was passed over.' },
  ],
  counts: { closed_q: 1, praise_generic: 0 },
};
const VERDICTS = { verdicts: [{ n: 1, verdict: 'keep' }, { n: 2, verdict: 'keep' }] };
const NARRATIVE = { opening: 'a', strengths: 'b', growth: 'c', closing: 'd' };

let sent;
const saved = {};

function consumerOf(prompt) {
  if (prompt.includes('checking the labels on moments')) return 'labels';
  if (prompt.includes('pick the few MOMENTS')) return 'moments';
  if (prompt.includes('NOTES-PROMPT')) return 'notes';
  return 'remark';
}

beforeEach(() => {
  sent = [];
  for (const k of SCRUBBED) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.OPENAI_API_KEY = 'test-openai';
  process.env.OPENROUTER_API_KEY = 'test-openrouter';
  process.env.SUPABASE_URL = 'http://127.0.0.1:1/observe2-moments-job-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-not-a-key';
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input && input.url ? input.url : input);
    let body = null;
    try { body = init.body ? JSON.parse(init.body) : null; } catch (_) { body = init.body; }
    const json = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });
    if (/\/chat\/completions/.test(url)) {
      const prompt = ((body && body.messages) || []).map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      const consumer = consumerOf(prompt);
      sent.push({ consumer, model: body.model, max: body.max_completion_tokens != null ? body.max_completion_tokens : body.max_tokens, format: body.response_format });
      const reply = { moments: MOMENTS, labels: VERDICTS, notes: {}, remark: NARRATIVE }[consumer];
      return json({
        id: 'chatcmpl-test', object: 'chat.completion', created: 0, model: body.model,
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(reply) }, finish_reason: 'stop' }],
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

/** One /observe2 visit's moments (both calls), one debrief-notes call as _extractNotes makes it, one remark narrative. */
async function run(perJob) {
  jest.resetModules();
  mockFake = createFakeSupabase({
    users: [{ id: 'coach-1', phone_number: '923000000001', name: 'Coach', preferred_language: 'en' }],
    app_settings: perJob ? [{ key: 'llm_per_job', value: perJob }] : [],
  });
  const sl = require('../../bot/shared/utils/structured-logger');
  await require('../../bot/shared/config/model-settings').refresh();
  const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
  const Moments = require('../../bot/shared/services/observe/observe2/moments');
  const GPT5MiniService = require('../../bot/shared/services/gpt5-mini.service');
  const { generateRemarkNarrative } = require('../../bot/shared/services/remark/remark-narrative.service');

  const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: {} });
  Object.assign(mockFake.__tables.observation_field_forms.find((r) => r.id === form.id), { period_minutes: 40, sealed_at: '2026-10-16T05:00:00.000Z' });
  mockFake.__tables.coaching_sessions = [{ id: 'sess-1', status: 'transcription_complete', transcript_text: TRANSCRIPT, observation_type: 'leader_observation', observer_user_id: 'coach-1', user_id: 'teacher-1' }];
  await Store.linkSession(form.id, 'sess-1');
  await Moments.runForSession('sess-1', '923000000001');

  // observe-send.service _extractNotes: no job named (its options, verbatim).
  await GPT5MiniService.completeJson('NOTES-PROMPT: write the notes.', { maxTokens: 6000, label: 'observeDebriefNotes' });
  await generateRemarkNarrative({ scores: [1, 2, 3, 4, 5].map((ordinal) => ({ ordinal, score: 2 })), comment: '', teacherName: 'T', language: 'en' }).catch(() => {});

  const cost = sl.logger.info.mock.calls.map((c) => c[0]).filter((e) => e && e.event === 'api.cost.incurred');
  const by = (consumer) => sent.filter((x) => x.consumer === consumer);
  const stored = mockFake.__tables.observation_field_forms.find((r) => r.id === form.id).rumi_moments;
  return { cost, by, stored };
}

describe('the /observe2 moments are their own job, observe2.moments (bd-08qvls.1)', () => {
  test('with no override, both calls go out as observe2.moments on today\'s model with today\'s request', async () => {
    const r = await run(null);
    for (const c of ['moments', 'labels']) {
      expect(r.by(c)).toEqual([{ consumer: c, model: TODAY, max: 16000, format: { type: 'json_object' } }]);
    }
    expect(r.stored.moments).toHaveLength(2);
    const jobs = r.cost.map((e) => e.job);
    expect(jobs.slice(0, 2)).toEqual(['observe2.moments', 'observe2.moments']);
    expect(r.by('notes').map((x) => x.model)).toEqual([TODAY]);
    expect(r.by('remark').map((x) => x.model)).toEqual([TODAY]);
    expect(jobs.slice(2)).toEqual(['coaching.completeJson', 'coaching.completeJson']);
  });

  test('the app_settings row moves observe2.moments: the moments and the label check move, the notes and the remark do not', async () => {
    const r = await run({ 'observe2.moments': MOVED });
    expect(r.by('moments').map((x) => x.model)).toEqual([MOVED]);
    expect(r.by('labels').map((x) => x.model)).toEqual([MOVED]);
    expect(r.by('notes').map((x) => x.model)).toEqual([TODAY]);
    expect(r.by('remark').map((x) => x.model)).toEqual([TODAY]);
  });

  test('a move of coaching.completeJson no longer moves the moments', async () => {
    const r = await run({ 'coaching.completeJson': MOVED });
    expect(r.by('moments').map((x) => x.model)).toEqual([TODAY]);
    expect(r.by('labels').map((x) => x.model)).toEqual([TODAY]);
    expect(r.by('notes').map((x) => x.model)).toEqual([MOVED]);
    expect(r.by('remark').map((x) => x.model)).toEqual([MOVED]);
  });

  test('the registry holds the new job like completeJson: same model, its site, its reply checked as its caller parses it', () => {
    jest.resetModules();
    const { JOBS, JSON_REPAIRED_BY_CALLER, modelFor } = require('../../bot/shared/config/model-registry');
    expect(JOBS['observe2.moments']).toEqual(expect.objectContaining({
      env: null, default: JOBS['coaching.completeJson'].default, site: 'shared/services/observe/observe2/moments.js',
    }));
    expect(modelFor('observe2.moments')).toBe('gpt-5-mini-2025-08-07');
    expect(JSON_REPAIRED_BY_CALLER['observe2.moments']).toBe(JSON_REPAIRED_BY_CALLER['coaching.completeJson']);
  });
});
