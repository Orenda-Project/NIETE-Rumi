/**
 * A job label must NEVER reach a model vendor. bd-3kv02.
 *
 * WHY THIS EXISTS. bd-8xmp9 labelled 62 call sites and argued they were telemetry-only because
 * "the chokepoint strips `job` before the request goes out". That was true for the sites whose
 * client comes from llm-client -- and false for five that build their own `new OpenAI(...)`:
 *
 *   quiz/quiz-generation, quiz/quiz-report, quiz/quiz-session, quiz/video-quiz-report
 *     -> raw client, api.openai.com, which rejects unknown top-level fields with a 400
 *   coaching/reflective-questions/llm-router
 *     -> raw client pointed at OpenRouter
 *
 * For those, nothing stripped `job`, so it was sent to the vendor in the request body. The label
 * bought nothing there either: a raw client never reaches recordModelCost, so it was all risk and
 * no attribution. It shipped to sandbox and staging and was caught in review before any quiz
 * traffic hit it and before it reached main.
 *
 * The tests that should have caught it did not, because they mocked the `openai` module -- and a
 * mock that accepts anything is exactly what hid a real client that sends everything. So these
 * run REAL HTTP against a local server and read the body that actually arrived.
 *
 * A second, latent version of the same hazard lived in llm-client itself: with LLM_PROVIDER=openai,
 * createLLMClient() returned a bare `new OpenAI(...)` with no stripping wrapper. Every environment
 * runs `openrouter` today (checked on Railway, 2026-09-23), so it had never fired -- but it was one
 * variable away from breaking every labelled call at once.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const BOT = path.join(__dirname, '..', '..', 'bot');

// ---------------------------------------------------------------------------------------------
// A local stand-in for a vendor: records exactly what the client sent, answers like a vendor.
// ---------------------------------------------------------------------------------------------
let server;
let port;
const received = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try { received.push(JSON.parse(body)); } catch (_) { received.push({ __unparsed: body }); }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-test', object: 'chat.completion', created: 0, model: 'gpt-4o-mini',
        choices: [{ index: 0, message: { role: 'assistant', content: '{}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));
beforeEach(() => { received.length = 0; });

// ---------------------------------------------------------------------------------------------
// 1. The hazard, verified rather than assumed: a raw client sends whatever it is given.
// ---------------------------------------------------------------------------------------------
describe('why a raw client cannot carry a label (bd-3kv02)', () => {
  test('the OpenAI SDK sends an unknown `job` field to the vendor unchanged', async () => {
    const OpenAI = require('openai');
    const raw = new OpenAI({ apiKey: 'test', baseURL: `http://127.0.0.1:${port}/v1`, maxRetries: 0 });

    await raw.chat.completions.create({ model: 'gpt-4o-mini', messages: [], job: 'quiz.generate' });

    expect(received).toHaveLength(1);
    // If this ever starts failing, the SDK began stripping unknown fields and the structural
    // rule below could be relaxed. Until then, a label on a raw client IS a request field.
    expect(received[0].job).toBe('quiz.generate');
  });
});

// ---------------------------------------------------------------------------------------------
// 2. The regression guard: no labelled call site may build its own raw client.
// ---------------------------------------------------------------------------------------------
const EXCLUDE = /node_modules|__tests__|\/tests?\/|\.test\.js$|\/scripts\/|\/vendor\//;
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!EXCLUDE.test(`${p}/`)) walk(p, out); }
    else if (e.name.endsWith('.js') && !EXCLUDE.test(p)) out.push(p);
  }
  return out;
}

/** balanced {...} starting at or after `from` */
function block(src, from) {
  const open = src.indexOf('{', from);
  if (open < 0) return null;
  let d = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}' && --d === 0) return src.slice(open, i + 1);
  }
  return null;
}

/** does any create() in this file hand the vendor a request that carries `job:`? */
function carriesJobLabel(src) {
  for (const m of src.matchAll(/completions\s*\.\s*create\s*\(/g)) {
    const after = m.index + m[0].length;
    const arg = src.slice(after, after + 400).replace(/^\s*/, '');
    let req = null;
    if (arg.startsWith('{')) req = block(src, after);
    else {
      const id = (/^([A-Za-z_$][\w$]*)\s*[,)]/.exec(arg) || [])[1];
      const def = id && new RegExp(`(?:const|let|var)\\s+${id}\\s*=\\s*\\{`).exec(src);
      if (def) req = block(src, def.index);
    }
    if (req && /\bjob\s*:/.test(req)) return true;
  }
  return false;
}

describe('no labelled call site builds its own client (bd-3kv02)', () => {
  const sources = [...walk(path.join(BOT, 'shared')), ...walk(path.join(BOT, 'workers'))];
  const labelled = sources
    .filter((f) => !f.endsWith(path.join('services', 'llm-client.js'))) // the chokepoint itself
    .map((f) => ({ f, src: fs.readFileSync(f, 'utf8') }))
    .filter(({ src }) => carriesJobLabel(src));

  test('the scan finds the labelled files at all', () => {
    // Guard the guard: a scan that matched nothing would pass every assertion below.
    expect(labelled.length).toBeGreaterThan(15);
  });

  test('every one of them gets its client from llm-client, never the raw SDK', () => {
    // Keyed on IMPORTING the SDK, not on `new OpenAI(`: llm-router builds its client through
    // `lazyClient(OpenAI, ...)`, which a `new OpenAI(` check silently misses -- the first draft of
    // this guard did, and reported four offenders when there were five.
    const RAW_SDK = /require\(\s*['"]openai['"]\s*\)|from\s+['"]openai['"]|new\s+OpenAI\s*\(/;
    const offenders = labelled
      .filter(({ src }) => RAW_SDK.test(src))
      .map(({ f }) => path.relative(BOT, f));
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 2b. The same, EXECUTED: run a real raw-SDK service and read what it actually sent.
//
// The guard above is a source scan, and a scan alone is not a red test here -- it can pass while
// the code still does the wrong thing at runtime. This drives the real QuizGenerationService
// through its real client to a local server (the network boundary; nothing of ours is mocked), so
// a label put back on it fails for the reason that matters: the field arriving at the vendor.
// ---------------------------------------------------------------------------------------------
describe('a raw-SDK service sends the vendor no label when it actually runs (bd-3kv02)', () => {
  const saved = {};
  const KEYS = ['OPENAI_API_KEY', 'OPENAI_BASE_URL'];
  beforeEach(() => { for (const k of KEYS) saved[k] = process.env[k]; });
  afterEach(() => {
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });

  test('QuizGenerationService._generateQuestions: no `job` in the request body', async () => {
    process.env.OPENAI_API_KEY = 'test';
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1`;

    let QuizGenerationService;
    jest.isolateModules(() => {
      QuizGenerationService = require('../../bot/shared/services/quiz/quiz-generation.service');
    });
    try {
      await QuizGenerationService._generateQuestions({ topic: 'fractions', grade: 3, subject: 'maths' });
    } catch (_) {
      // The stub vendor answers `{}`, which the service rightly refuses to parse into questions.
      // Only the request it sent is under test here, not what it does with the reply.
    }

    // It must have really called out, or this passes by never running the line.
    expect(received.length).toBeGreaterThan(0);
    for (const body of received) expect('job' in body).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// 3. The latent half: llm-client's LLM_PROVIDER=openai branch must strip too.
// ---------------------------------------------------------------------------------------------
describe('llm-client strips the label whichever provider it runs (bd-3kv02)', () => {
  const saved = {};
  const KEYS = ['LLM_PROVIDER', 'OPENAI_API_KEY', 'OPENAI_BASE_URL'];

  beforeEach(() => { for (const k of KEYS) saved[k] = process.env[k]; });
  afterEach(() => {
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });

  test('LLM_PROVIDER=openai: neither `job` nor `fallbackModel` reaches the vendor', async () => {
    process.env.LLM_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'test';
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1`;

    let llm;
    jest.isolateModules(() => { llm = require('../../bot/shared/services/llm-client'); });
    await llm.getClient().chat.completions.create({
      model: 'gpt-4o-mini', messages: [], job: 'quiz.generate', fallbackModel: null,
    });

    expect(received).toHaveLength(1);
    expect('job' in received[0]).toBe(false);
    expect('fallbackModel' in received[0]).toBe(false);
    // ...and nothing else about the request moved: the direct-OpenAI branch must not pick up the
    // OpenRouter-only `openai/` model prefix on the way.
    expect(received[0].model).toBe('gpt-4o-mini');
  });
});
