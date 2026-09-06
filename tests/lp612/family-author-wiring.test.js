/**
 * bd-u6za9 — the family model + flash brief must reach the ACTUAL authoring call.
 *
 * WHY THIS SUITE EXISTS SEPARATELY FROM family-model-routing.test.js
 *
 * That suite proves the pure helpers (`familyForBook`, `resolveAuthorModel(family)`,
 * `authorTierFor`) behave. On its own that is NOT evidence the pilot is live: when
 * this work started, `lp612-author.service.js` carried its OWN private copy of
 * `resolveAuthorModel()` reading `LP_AUTHOR_MODEL` directly, and the worker calls
 * `authorLessonPlan()` WITHOUT a model — so the service's copy won, and a
 * family-aware resolver in `lp612-flags.js` would have been dead code while every
 * helper test passed.
 *
 * That is the exact failure the repo's TDD rule names: a pure-helper test plus a
 * wiring assumption ships a feature that never executes. So these tests drive
 * `authorLessonPlan()` — the function the worker actually calls — and assert on
 * what reached the mocked LLM boundary: the model id, and which brief was used as
 * the system prompt.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../bot/shared/services/llm-client', () => {
  const create = jest.fn();
  return { getClient: () => ({ chat: { completions: { create } } }), __create: create };
});

// The reasoning-contract assertion is a LOG, so the logger is the observable here.
jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: jest.fn(),
  logError: jest.fn(),
  logWarn: jest.fn(),
}));

const create = require('../../bot/shared/services/llm-client').__create;
const { authorLessonPlan } = require('../../bot/shared/services/lp612-author.service');

const CLEAN_DOC = require('./__fixtures__/v9_gate_base.lp.json');

const VENDOR = path.resolve(__dirname, '../../bot/vendor/lp-v9');
const readBrief = (f) => fs.readFileSync(path.join(VENDOR, f), 'utf8');

const DSFLASH = 'deepseek/deepseek-v4-flash';
const SONNET = 'anthropic/claude-sonnet-5';

const BOOK_FOR = (stem, subject) => ({
  title: subject, publisher: 'NBF', subject, grade: 9,
  medium: 'en', language: 'English', offset: 4, stem,
});
const TOC = { chapters: [{ number: 1, title: 'Chapter One', printed_start: 9 }] };

function segmentFor(bookStem, subject) {
  return {
    segment_id: `seg-${bookStem}`,
    book_stem: bookStem,
    grade: 9,
    subject,
    medium: 'en',
    language: 'English',
    chapter_number: 1,
    chapter_title: 'Chapter One',
    chapter_key: 'ch1',
    part: null,
    subtopic_title: 'A subtopic',
    menu_title: 'A subtopic',
    section_ref: '1.1',
    printed_page_start: 11,
    printed_page_end: 12,
    pages_covered: [11, 12],
    order_index: 1,
    lp_type: 'SCI-9-10',
    segment_index: 1,
    day_number: 1,
    skill_type: 'concept',
    slo_text: 'An outcome.',
    yt: null,
    notes: null,
    prev_segment_id: null,
    next_segment_id: null,
  };
}

const reply = (obj) => ({
  choices: [{ message: { content: JSON.stringify(obj) } }],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
});

let dir;

function seedPageTruth(bookStem, subject) {
  const d = path.join(dir, bookStem);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, '_book.json'), JSON.stringify(BOOK_FOR(bookStem, subject)));
  fs.writeFileSync(path.join(d, '_toc.json'), JSON.stringify(TOC));
  for (const n of [11, 12]) {
    fs.writeFileSync(path.join(d, `pg_${String(n).padStart(3, '0')}.json`), JSON.stringify({
      printed_page_number: n,
      pdf_page_index: n + 4,
      page_type: 'content',
      blocks: [
        { t: 'heading', text: `1.${n} A heading` },
        { t: 'prose', text: `Body text of printed page ${n}.` },
      ],
    }));
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-family-'));
  process.env.LP612_PAGE_TRUTH_DIR = dir;
  process.env.LP612_AUTHOR_ROUNDS = '0';
  delete process.env.LP_AUTHOR_MODEL;
  delete process.env.LP_AUTHOR_MODEL_MATHS_PHYSICS;
  delete process.env.LP612_AUTHOR_TIER;
});

afterEach(() => {
  for (const k of [
    'LP612_PAGE_TRUTH_DIR', 'LP612_AUTHOR_ROUNDS', 'LP_AUTHOR_MODEL',
    'LP_AUTHOR_MODEL_MATHS_PHYSICS', 'LP612_AUTHOR_TIER',
  ]) delete process.env[k];
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('bd-u6za9 — the pilot reaches the real authoring call', () => {
  test('a PHYSICS segment authors on the pilot model with the MATHS flash brief', async () => {
    process.env.LP_AUTHOR_MODEL = SONNET;
    process.env.LP_AUTHOR_MODEL_MATHS_PHYSICS = DSFLASH;
    seedPageTruth('grade_9_physics', 'physics');
    create.mockResolvedValueOnce(reply(CLEAN_DOC));

    const out = await authorLessonPlan({
      segment: segmentFor('grade_9_physics', 'physics'),
      lang: 'en',
      correlationId: 'test-phys',
    });

    const call = create.mock.calls[0][0];
    expect(call.model).toBe(DSFLASH);
    expect(call.messages[0].content).toBe(readBrief('brief_author_v3_flash_maths.md'));
    // The result must report what actually ran, or a bake-off row is mislabelled.
    expect(out.model).toBe(DSFLASH);
    expect(out.family).toBe('maths');
    expect(out.tier).toBe('flash');
  });

  test('a MATHEMATICS segment takes the same pilot lane', async () => {
    process.env.LP_AUTHOR_MODEL = SONNET;
    process.env.LP_AUTHOR_MODEL_MATHS_PHYSICS = DSFLASH;
    seedPageTruth('grade_8_mathematics', 'mathematics');
    create.mockResolvedValueOnce(reply(CLEAN_DOC));

    await authorLessonPlan({
      segment: segmentFor('grade_8_mathematics', 'mathematics'),
      lang: 'en',
      correlationId: 'test-math',
    });

    expect(create.mock.calls[0][0].model).toBe(DSFLASH);
  });

  test('a BIOLOGY segment stays on sonnet with the STANDARD v3 brief — the pilot is scoped', async () => {
    process.env.LP_AUTHOR_MODEL = SONNET;
    process.env.LP_AUTHOR_MODEL_MATHS_PHYSICS = DSFLASH;
    seedPageTruth('grade_9_biology', 'biology');
    create.mockResolvedValueOnce(reply(CLEAN_DOC));

    const out = await authorLessonPlan({
      segment: segmentFor('grade_9_biology', 'biology'),
      lang: 'en',
      correlationId: 'test-bio',
    });

    const call = create.mock.calls[0][0];
    expect(call.model).toBe(SONNET);
    // The production path must be byte-identical to what is serving today.
    expect(call.messages[0].content).toBe(readBrief('brief_author_v3.md'));
    expect(out.tier).toBe('standard');
  });

  test('an URDU segment stays on sonnet — prose was measurably HARMED by a maths preamble', async () => {
    process.env.LP_AUTHOR_MODEL = SONNET;
    process.env.LP_AUTHOR_MODEL_MATHS_PHYSICS = DSFLASH;
    seedPageTruth('grade_10_urdu', 'urdu');
    create.mockResolvedValueOnce(reply(CLEAN_DOC));

    await authorLessonPlan({
      segment: segmentFor('grade_10_urdu', 'urdu'),
      lang: 'ur',
      correlationId: 'test-urdu',
    });

    const call = create.mock.calls[0][0];
    expect(call.model).toBe(SONNET);
    expect(call.messages[0].content).toBe(readBrief('brief_author_v3.md'));
  });

  test('UNSETTING the pilot var puts physics back on sonnet AND back on the standard brief — full revert, no deploy', async () => {
    process.env.LP_AUTHOR_MODEL = SONNET;
    // pilot var deliberately absent
    seedPageTruth('grade_9_physics', 'physics');
    create.mockResolvedValueOnce(reply(CLEAN_DOC));

    const out = await authorLessonPlan({
      segment: segmentFor('grade_9_physics', 'physics'),
      lang: 'en',
      correlationId: 'test-revert',
    });

    const call = create.mock.calls[0][0];
    expect(call.model).toBe(SONNET);
    expect(call.messages[0].content).toBe(readBrief('brief_author_v3.md'));
    expect(out.tier).toBe('standard');
  });

  test('an explicit model argument still wins over the family default — bake-off scripts pin one id per cell', async () => {
    process.env.LP_AUTHOR_MODEL = SONNET;
    process.env.LP_AUTHOR_MODEL_MATHS_PHYSICS = DSFLASH;
    seedPageTruth('grade_9_physics', 'physics');
    create.mockResolvedValueOnce(reply(CLEAN_DOC));

    await authorLessonPlan({
      segment: segmentFor('grade_9_physics', 'physics'),
      lang: 'en',
      model: 'google/gemini-3.8-flash',
      correlationId: 'test-explicit',
    });

    expect(create.mock.calls[0][0].model).toBe('google/gemini-3.8-flash');
  });

  test('the flash tier is used for ANY flash model, not only the pilot var — tier follows the model', async () => {
    process.env.LP_AUTHOR_MODEL = 'google/gemini-3.8-flash';
    seedPageTruth('grade_9_biology', 'biology');
    create.mockResolvedValueOnce(reply(CLEAN_DOC));

    const out = await authorLessonPlan({
      segment: segmentFor('grade_9_biology', 'biology'),
      lang: 'en',
      correlationId: 'test-tier',
    });

    expect(create.mock.calls[0][0].messages[0].content)
      .toBe(readBrief('brief_author_v3_flash_sci.md'));
    expect(out.tier).toBe('flash');
  });
});

describe('bd-u6za9 — the reasoning contract is asserted in CODE, not hoped for', () => {
  /**
   * MEASURED 2026-09-03, provider-pinned through OpenRouter on deepseek-v4-flash:
   *
   *   provider     no flag    reasoning:{enabled:false}   thinking:{type:disabled}
   *   StreamLake   2,680 tok  0                           2,788  <-- IGNORED
   *   Baidu        6,320 tok  0                           3,278  <-- IGNORED
   *   Azure        0          0                           0
   *   DeepInfra    0          0                           0
   *
   * Two things follow. First, `thinking:{type:"disabled"}` is the DIRECT
   * api.deepseek.com spelling and OpenRouter silently ignores it — only
   * `reasoning:{enabled:false}` works on this path. Second, and the reason for
   * these tests: whether reasoning happens at all depends on which upstream
   * OpenRouter load-balanced to, which we do not control. Reasoning bills as
   * completion tokens and truncates the JSON at max_tokens, so a provider that
   * ignored the flag would silently cost ~60s and a broken document.
   *
   * A prompt-or-payload flag is not a contract until code checks the result.
   */
  test('reasoning is disabled on the request', async () => {
    seedPageTruth('grade_9_physics', 'physics');
    create.mockResolvedValueOnce(reply(CLEAN_DOC));

    await authorLessonPlan({
      segment: segmentFor('grade_9_physics', 'physics'),
      lang: 'en',
      correlationId: 'test-reasoning',
    });

    expect(create.mock.calls[0][0].reasoning).toEqual({ enabled: false });
  });

  test('a response that reasoned ANYWAY is reported as a distinct named warning, not silently accepted', async () => {
    const { logToFile } = require('../../bot/shared/utils/logger');
    seedPageTruth('grade_9_physics', 'physics');
    create.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify(CLEAN_DOC) } }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 3000,
        total_tokens: 3010,
        completion_tokens_details: { reasoning_tokens: 2788 },
      },
    });

    await authorLessonPlan({
      segment: segmentFor('grade_9_physics', 'physics'),
      lang: 'en',
      correlationId: 'test-reasoned-anyway',
    });

    const warned = logToFile.mock.calls.some(
      ([msg, data, level]) =>
        /reasoning/i.test(String(msg)) &&
        level === 'warn' &&
        data && data.reasoningTokens === 2788
    );
    expect(warned).toBe(true);
  });
});
