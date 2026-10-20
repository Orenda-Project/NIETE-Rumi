'use strict';
/**
 * bd-xw56ed — the fallthrough classifier chooses from the teacher's LIVE menu, not a fixed list.
 *
 * Production, 20 Oct 2026: a teacher's "/assesments" reached detectIntent, whose four fixed labels were lesson_plan,
 * presentation, video and general. Assessments were not among them, so it said general and the AI chat answered —
 * with an assessment written in chat, not the generator. The labels are now this teacher's menu rows (the same
 * featureMenuRows + menuGates the /menu list is drawn from), plus `unsure` and `general`. Presentation is gone
 * (operator, 20 Oct: it is not a menu entry).
 *
 * Driven on the REAL openai.service.detectIntent and the REAL llm-client; only the network (fetch) and the database
 * client are stubbed.
 */

const REAL_FETCH = globalThis.fetch;
const SCRUBBED = [
  'REDIS_URL', 'WHATSAPP_TOKEN', 'WHATSAPP_ACCESS_TOKEN', 'PHONE_NUMBER_ID', 'E2E_CASSETTE',
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_BASE_URL', 'LLM_PROVIDER', 'LLM_MODEL',
  'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'LLM_JOB_MODELS', 'ANTHROPIC_API_KEY', 'LLM_FALLBACK_OFF',
  'TEACHER_TRAINING_FLOW_ID', 'OBSERVE_MEWAKA_FLOW_ID', 'ROSTER_FLOW_ID', 'CLASS_MANAGER_FLOW_ID',
  'STUDENT_VIDEOS_FLOW_ID', 'TRANSCRIPT_QUIZ_ENABLED', 'TRANSCRIPT_QUIZ_FLOW_ID', 'ASSESSMENT_GEN_FLOW_ID',
];

let mockSettings; // app_settings rows the database answers with
jest.mock('../../bot/shared/config/supabase', () => {
  const answer = (rows) => ({ data: rows, error: null });
  const chain = (table) => {
    const filters = {};
    const c = new Proxy(function chainable() {}, {
      get: (_t, prop) => {
        if (prop === 'then') {
          const rows = table === 'app_settings'
            ? mockSettings.filter((r) => (filters.key === undefined || r.key === filters.key)
              && (!filters.keys || filters.keys.includes(r.key)))
            : [];
          return (resolve) => resolve(answer(rows));
        }
        if (prop === 'eq') return (col, v) => { filters[col] = v; return c; };
        if (prop === 'in') return (col, vs) => { if (col === 'key') filters.keys = vs; return c; };
        if (prop === 'single' || prop === 'maybeSingle') {
          return () => Promise.resolve({ data: mockSettings.find((r) => r.key === filters.key) || null, error: null });
        }
        return () => c;
      },
      apply: () => c,
    });
    return c;
  };
  return { from: (table) => chain(table), rpc: async () => answer([]) };
});

let classifierRequests; // every chat.completions body that carried the classifier prompt
let modelSays; // what the model answers the classifier
let modelFails; // the classifier call errors, so the keyword fallback answers
const saved = {};

beforeEach(() => {
  classifierRequests = [];
  modelSays = 'general';
  modelFails = false;
  mockSettings = [{ key: 'assessment_generator_enabled', value: true }];
  for (const k of SCRUBBED) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.OPENAI_API_KEY = 'test-openai';
  process.env.OPENROUTER_API_KEY = 'test-openrouter';
  process.env.TEACHER_TRAINING_FLOW_ID = 'flow-training';
  process.env.ASSESSMENT_GEN_FLOW_ID = 'flow-assess';
  process.env.STUDENT_VIDEOS_FLOW_ID = 'flow-videos';
  // NOT the quiz (TRANSCRIPT_QUIZ_*), observe, roster or classes Flows: those rows are not on this menu.
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input && input.url ? input.url : input);
    let body = null;
    try { body = init.body ? JSON.parse(init.body) : null; } catch (_) { body = init.body; }
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
    if (/\/chat\/completions/.test(url)) {
      classifierRequests.push(body);
      if (modelFails) return json({ error: { message: 'upstream down' } }, 500);
      return json({
        id: 'chatcmpl-test', object: 'chat.completion', created: 0, model: (body && body.model) || 'x',
        choices: [{ index: 0, message: { role: 'assistant', content: modelSays }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 800, completion_tokens: 2, total_tokens: 802 },
      });
    }
    return json({ ok: true });
  };
});

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  for (const k of SCRUBBED) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

const TEACHER = { id: 'u-teacher', role: 'teacher', preferred_language: 'ur' };

async function load() {
  jest.resetModules();
  await require('../../bot/shared/config/model-settings').refresh();
  const svc = require('../../bot/shared/services/openai.service');
  const { liveMenuChoices } = require('../../bot/shared/services/menu-match.service');
  return { svc, choices: await liveMenuChoices(TEACHER) };
}

const promptOf = (req) => req.messages.find((m) => m.role === 'system').content;

describe('the choices are the live menu', () => {
  test("a teacher's choices are her feature rows whose feature can start — no language, no Ask Anything", async () => {
    const { choices } = await load();
    expect(choices.map((c) => c.rowId)).toEqual([
      'menu_lesson_plan', 'menu_coaching', 'menu_training', 'menu_attendance', 'menu_assessment', 'menu_videos',
    ]);
    const assessment = choices.find((c) => c.rowId === 'menu_assessment');
    expect(assessment).toMatchObject({ label: 'assessment', commands: ['/assessment', '/exam'] });
    expect(assessment.title.en).toBeTruthy();
    expect(assessment.title.ur).toBeTruthy();
  });

  test('the assessment row leaves the choices when its database switch is off', async () => {
    mockSettings = [];
    const { choices } = await load();
    expect(choices.map((c) => c.rowId)).not.toContain('menu_assessment');
  });

  test('the prompt offers exactly those rows, by the words the menu shows, and never presentation', async () => {
    const { svc, choices } = await load();
    await svc.detectIntent('/assesments', '', choices);
    expect(classifierRequests).toHaveLength(1);
    const prompt = promptOf(classifierRequests[0]);
    expect(prompt).toContain('"lesson_plan"'); // lesson plans keep their own, production-tuned rules
    for (const c of choices.filter((choice) => choice.label !== 'lesson_plan')) {
      expect(prompt).toContain(`"${c.label}"`);
      expect(prompt).toContain(c.title.en);
      expect(prompt).toContain(c.title.ur);
    }
    expect(prompt).toContain('"unsure"');
    expect(prompt).toContain('"menu"');
    expect(prompt).toContain('"general"');
    expect(prompt).not.toMatch(/presentation/i);
    expect(prompt).not.toContain('"quiz"'); // not on her menu
  });
});

describe('what the answer means', () => {
  test.each([
    ['assessment', { type: 'feature', rowId: 'menu_assessment', label: 'assessment' }],
    ['**training**', { type: 'feature', rowId: 'menu_training', label: 'training' }],
    ['videos', { type: 'feature', rowId: 'menu_videos', label: 'videos' }],
    ['lesson_plan', { type: 'lesson_plan' }],
    ['menu', { type: 'menu' }], // she asked for the menu itself
    ['unsure', { type: 'unsure' }],
    ['quiz', { type: 'unsure' }], // a real row, but not on HER menu: never opened, never chat
    ['general lp_ref', { type: 'general', lp_reference: true }],
    ['general', { type: 'general', lp_reference: false }],
  ])('model says %j → %j', async (said, expected) => {
    const { svc, choices } = await load();
    modelSays = said;
    const intent = await svc.detectIntent('mujhe kuch chahiye', '', choices);
    expect(intent).toMatchObject({ ...expected, message: 'mujhe kuch chahiye' });
  });

  test('"presentation" is no longer an answer', async () => {
    const { svc, choices } = await load();
    modelSays = 'presentation';
    const intent = await svc.detectIntent('make slides on the water cycle', '', choices);
    expect(intent.type).not.toBe('presentation');
  });

  // Eval v1 on production messages (13–20 Oct): 42% of what production answered as chat came back unsure — "Ok",
  // "5", "Maths", replies to the chat's own question. The prompt must say, with examples, that those stay chat.
  test('the prompt tells the model that short replies and answers are chat, and that "lp" is a lesson plan', async () => {
    const { svc, choices } = await load();
    await svc.detectIntent('Ok', '', choices);
    const prompt = promptOf(classifierRequests[0]);
    for (const reply of ['"Ok"', '"5"', '"Yes"']) expect(prompt).toContain(`${reply} → general`);
    // Eval v2: a class, grade or subject on its own was read as a short reply and lost its lesson plan (30 of 120
    // production lesson-plan requests). Those keep today's lesson-plan rules.
    expect(prompt).not.toContain('"Maths" → general');
    expect(prompt).toMatch(/lesson_plan rules above still decide/);
    expect(prompt).toMatch(/"New lp" → lesson_plan/);
    expect(prompt).toMatch(/"Menu" → menu/);
  });

  test('a single unrecognised /word is a request for something, never chat', async () => {
    const { svc, choices } = await load();
    modelSays = 'general';
    const intent = await svc.detectIntent('/xyzzy', '', choices);
    expect(intent.type).toBe('unsure');
  });
});

describe('when the model call fails, the keyword fallback reads the same menu', () => {
  test('a lesson-plan word is still a lesson plan', async () => {
    const { svc, choices } = await load();
    modelFails = true;
    expect((await svc.detectIntent('lesson plan chahiye', '', choices)).type).toBe('lesson_plan');
  });

  test('a video word opens the live Videos row', async () => {
    const { svc, choices } = await load();
    modelFails = true;
    expect(await svc.detectIntent('video dikhao', '', choices)).toMatchObject({ type: 'feature', rowId: 'menu_videos' });
  });

  test('a presentation word is no longer a presentation', async () => {
    const { svc, choices } = await load();
    modelFails = true;
    expect((await svc.detectIntent('make a powerpoint', '', choices)).type).not.toBe('presentation');
  });
});
