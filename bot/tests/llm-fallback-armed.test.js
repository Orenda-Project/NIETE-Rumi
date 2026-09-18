/**
 * The ladder is armed, and it carries weight. bd-b8k7h.
 *
 * bd-4uw7n built the ladder and armed it nowhere. It fires only when a caller names its job,
 * and no production call site did: lp612-author passed { correlationId, stage } and
 * transcript-quiz-llm passed nothing at all. The only `{ job }` in the repo was a doc comment
 * and a unit test, so the whole thing was merged and inert.
 *
 * Arming it is a NO-OP TODAY and that is by construction, not by accident: every job's frozen
 * fallback is still the model it runs, so the self-skip guard declines to fall back to the
 * thing that just failed. Protection appears the moment a primary diverges from its fallback.
 *
 * Which is the real gap this file closes. Proving the mechanism with a hand-passed
 * fallbackModel proves the plumbing. It does not prove that a job whose model has actually
 * MOVED gets caught, which is the only scenario anybody will ever rely on.
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const strip = (s) => s.split('\n')
  .map((l) => l.replace(/^\s*\/\/.*$/, '').replace(/^\s*\*.*$/, '')).join('\n');

describe('bd-b8k7h — the call sites name their job', () => {
  const CALLERS = {
    'shared/services/quiz/transcript-quiz-llm.js': 'quiz.transcript',
    'shared/services/lp612-author.service.js': 'lp.author',
  };

  for (const [rel, job] of Object.entries(CALLERS)) {
    it(`${path.basename(rel)} names ${job}`, () => {
      const src = strip(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
      const call = new RegExp(`getClientForModel\\([^)]*job:\\s*'${job.replace('.', '\\.')}'`);
      expect(src).toMatch(call);
    });
  }

  it('every getClientForModel caller in the bot names a job', () => {
    const files = [];
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (!/node_modules|__mocks__/.test(p)) walk(p); }
        else if (e.name.endsWith('.js')) files.push(p);
      }
    })(path.join(ROOT, 'shared'));
    const unarmed = [];
    for (const f of files) {
      if (f.endsWith('llm-client.js')) continue;         // the factory itself
      const src = strip(fs.readFileSync(f, 'utf8'));
      for (const m of src.matchAll(/getClientForModel\(([^;]*?)\)/g)) {
        if (!/job:/.test(m[0])) unarmed.push(`${path.relative(ROOT, f)}: ${m[0].slice(0, 60)}`);
      }
    }
    expect({ callersWithNoJob: unarmed }).toEqual({ callersWithNoJob: [] });
  });
});

describe('bd-b8k7h — the net holds once a job has actually moved', () => {
  let attempts; let logged; let failWith;

  const load = (env = {}) => {
    jest.resetModules();
    attempts = []; logged = []; failWith = null;
    Object.assign(process.env, { OPENROUTER_API_KEY: 'k', LLM_PROVIDER: 'openrouter', ...env });
    jest.doMock('openai', () => class FakeOpenAI {
      constructor() {
        this.chat = { completions: { create: async (p) => {
          attempts.push(p.model);
          if (failWith && attempts.length === 1) throw failWith;
          return { model: p.model, usage: { prompt_tokens: 1, completion_tokens: 1 },
                   choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] };
        } } };
      }
    });
    jest.doMock('@anthropic-ai/sdk', () => class FakeAnthropic {});
    jest.doMock('../shared/utils/structured-logger', () => ({
      logEvent: (e, p) => logged.push({ event: e, payload: p }),
      logToFile: () => {}, logger: { info() {}, warn() {}, error() {} },
      getCurrentCorrelationId: () => 't', runWithCorrelation: (i, f) => f(),
      generateCorrelationId: () => 't',
    }));
    return require('../shared/services/llm-client');
  };
  afterEach(() => { jest.resetModules(); delete process.env.TRANSCRIPT_QUIZ_MODEL; });

  const err = (status, message = 'boom') => Object.assign(new Error(message), { status });

  it('does nothing while the job still runs its own frozen fallback', async () => {
    const { getClientForModel } = load();
    const { client } = getClientForModel('google/gemini-2.5-flash', { job: 'quiz.transcript' });
    failWith = err(503, 'upstream unavailable');
    await expect(client.chat.completions.create({ model: 'google/gemini-2.5-flash', messages: [] }))
      .rejects.toThrow('upstream unavailable');
    // exactly one attempt: falling back to the model that just failed would be theatre
    expect(attempts).toEqual(['google/gemini-2.5-flash']);
  });

  it('catches the job once its model has moved to Anthropic', async () => {
    // The scenario the whole mechanism exists for, and the one the earlier tests never ran:
    // the primary has MOVED, the frozen fallback has not, and the supplier is down.
    process.env.TRANSCRIPT_QUIZ_MODEL = 'anthropic/claude-sonnet-5';
    const { getClientForModel } = load();
    const { todaysModel } = require('../shared/config/model-registry');
    const moved = todaysModel('quiz.transcript');
    expect(moved).toBe('anthropic/claude-sonnet-5');

    const { client } = getClientForModel(moved, { job: 'quiz.transcript' });
    failWith = err(503, 'anthropic unavailable');
    const res = await client.chat.completions.create({ model: moved, messages: [] });

    expect(attempts).toEqual(['anthropic/claude-sonnet-5', 'google/gemini-2.5-flash']);
    expect(res.usage.provider_fallback).toBe(true);
    expect(res.usage.provider_fallback_to).toBe('google/gemini-2.5-flash');
  });

  it('falls back to what the job used to run, never to a blanket OpenAI model', async () => {
    process.env.TRANSCRIPT_QUIZ_MODEL = 'anthropic/claude-opus-5';
    const { getClientForModel } = load();
    const { client } = getClientForModel('anthropic/claude-opus-5', { job: 'quiz.transcript' });
    failWith = err(402, 'insufficient credits');
    await client.chat.completions.create({ model: 'anthropic/claude-opus-5', messages: [] });
    expect(attempts[1]).toBe('google/gemini-2.5-flash');
    expect(attempts[1]).not.toMatch(/gpt-4o/);
  });

  it('says which pair it swapped, so the swap is answerable from a log', async () => {
    process.env.TRANSCRIPT_QUIZ_MODEL = 'anthropic/claude-sonnet-5';
    const { getClientForModel } = load();
    const { client } = getClientForModel('anthropic/claude-sonnet-5', { job: 'quiz.transcript' });
    failWith = err(402, 'insufficient credits');
    await client.chat.completions.create({ model: 'anthropic/claude-sonnet-5', messages: [] });
    const hit = logged.find((l) => l.event === 'llm.vendor_fallback');
    expect(hit.payload.from).toBe('anthropic/claude-sonnet-5');
    expect(hit.payload.to).toBe('google/gemini-2.5-flash');
    expect(hit.payload.status).toBe(402);
  });

  it('leaves lesson-plan authoring unprotected, because it has no validated fallback', async () => {
    // Stated as a test rather than left implicit: lp.author already runs Anthropic and has no
    // OpenAI predecessor anybody validated, so it fails rather than answering a teacher with
    // a model nobody checked.
    const { getClientForModel } = load();
    const { client } = getClientForModel('anthropic/claude-opus-5', { job: 'lp.author' });
    failWith = err(503, 'anthropic unavailable');
    await expect(client.chat.completions.create({ model: 'anthropic/claude-opus-5', messages: [] }))
      .rejects.toThrow('anthropic unavailable');
    expect(attempts).toEqual(['anthropic/claude-opus-5']);
  });
});
