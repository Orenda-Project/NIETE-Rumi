/**
 * bd-86ivw — the two stages BETWEEN the queue and the delivery.
 *
 * `lp612 author finished` and `lp612 render ok` are the only trace of the two most expensive
 * steps in the lane, and both are prose. Neither can answer "what is the clean-first-pass rate on
 * the pilot model this week" or "how often does the render gate reject a document" without a
 * regex over free text that breaks the next time someone edits the sentence.
 *
 * Both stages keep their existing lines untouched and additionally emit ONE named event.
 *
 * Driven through the real functions the worker calls — `authorLessonPlan()` and
 * `renderLessonPlan()` — with the LLM and the vendored renderer doubled at their boundaries.
 * The author harness is the one from family-author-wiring.test.js, for the reason that suite
 * gives: the pure helpers can be green while the production caller bypasses them entirely.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const mockLogEvent = jest.fn();
const mockRenderDoc = jest.fn();

jest.mock('../../bot/shared/services/llm-client', () => {
  const create = jest.fn();
  return { getClient: () => ({ chat: { completions: { create } } }), __create: create };
});
jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(),
}));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (...a) => mockLogEvent(...a),
  getCurrentCorrelationId: () => undefined,
}));
jest.mock('../../bot/vendor/lp-v9/render_lp.js', () => ({ renderDoc: (...a) => mockRenderDoc(...a) }));

const create = require('../../bot/shared/services/llm-client').__create;
const { authorLessonPlan } = require('../../bot/shared/services/lp612-author.service');
const { renderLessonPlan } = require('../../bot/shared/services/lp612-render.service');

const CLEAN_DOC = require('./__fixtures__/v9_gate_base.lp.json');

const named = (name) => mockLogEvent.mock.calls.filter((c) => c[0] === name);

// ── author ──────────────────────────────────────────────────────────────────

const BOOK = (stem, subject) => ({
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
  fs.writeFileSync(path.join(d, '_book.json'), JSON.stringify(BOOK(bookStem, subject)));
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-telemetry-'));
  process.env.LP612_PAGE_TRUTH_DIR = dir;
  process.env.LP612_AUTHOR_ROUNDS = '0';
  delete process.env.LP_AUTHOR_MODEL;
  delete process.env.LP_AUTHOR_MODEL_MATHS_PHYSICS;
  delete process.env.LP612_AUTHOR_TIER;
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.LP612_PAGE_TRUTH_DIR;
  delete process.env.LP612_AUTHOR_ROUNDS;
});

describe('the author stage emits lp612.author.completed', () => {
  test('it names the model, the family, the tier and whether the document linted clean', async () => {
    seedPageTruth('grade_9_physics', 'Physics');
    create.mockResolvedValue(reply(CLEAN_DOC));

    await authorLessonPlan({
      segment: segmentFor('grade_9_physics', 'Physics'),
      lang: 'en',
      correlationId: 'corr-author',
    });

    expect(named('lp612.author.completed')).toHaveLength(1);
    const payload = named('lp612.author.completed')[0][1];
    expect(payload).toMatchObject({
      segmentId: 'seg-grade_9_physics',
      lang: 'en',
      // physics routes to the 'maths' family — the one the pilot re-routes by env
      family: 'maths',
      tier: 'standard',
      model: 'anthropic/claude-sonnet-5',
      rounds: 0,
      correlationId: 'corr-author',
    });
    expect(typeof payload.lintClean).toBe('boolean');
    expect(typeof payload.elapsedMs).toBe('number');
  });

  test('the PILOT model reaches the event, so a bake-off row knows which harness produced it', async () => {
    process.env.LP_AUTHOR_MODEL_MATHS_PHYSICS = 'deepseek/deepseek-v4-flash';
    seedPageTruth('grade_9_physics', 'Physics');
    create.mockResolvedValue(reply(CLEAN_DOC));

    await authorLessonPlan({
      segment: segmentFor('grade_9_physics', 'Physics'), lang: 'en', correlationId: 'c',
    });

    expect(named('lp612.author.completed')[0][1]).toMatchObject({
      model: 'deepseek/deepseek-v4-flash',
      tier: 'flash',
      family: 'maths',
    });
  });
});

// ── render ──────────────────────────────────────────────────────────────────

describe('the render stage emits lp612.render.completed / .failed', () => {
  const outDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-render-'));

  test('a clean render emits completed with the page count and the phase', async () => {
    mockRenderDoc.mockResolvedValue({
      pdfPath: '/tmp/a.pdf', htmlPath: '/tmp/a.html', pdfPages: 5,
      pagesByPart: { teach: 3, support: 2 }, problems: [], warnings: [],
      report: { overlay_applied: [] },
    });

    await renderLessonPlan({
      lpDoc: { lesson_id: 'x' },
      lang: 'ur',
      stem: 'seg_x',
      outDir: outDir(),
      correlationId: 'corr-render',
      segmentId: 'grade_9_physics.c01.p011-012',
      renderId: 'render-9',
      phase: 'final',
    });

    expect(named('lp612.render.completed')).toHaveLength(1);
    expect(named('lp612.render.completed')[0][1]).toMatchObject({
      segmentId: 'grade_9_physics.c01.p011-012',
      renderId: 'render-9',
      lang: 'ur',
      phase: 'final',
      pageCount: 5,
      correlationId: 'corr-render',
    });
  });

  test('a defect list emits failed, carrying the renderer\'s own problem strings', async () => {
    mockRenderDoc.mockResolvedValue({
      pdfPath: '/tmp/a.pdf', htmlPath: '/tmp/a.html', pdfPages: 6,
      pagesByPart: { teach: 6 },
      problems: ['PAGE COUNT: support needs 6 pages; the cap is 4.'],
      warnings: [], report: {},
    });

    await expect(renderLessonPlan({
      lpDoc: { lesson_id: 'x' }, lang: 'en', stem: 'seg_x', outDir: outDir(),
      correlationId: 'corr-render', segmentId: 'seg-1', renderId: 'render-9', phase: 'gate',
    })).rejects.toThrow(/defect/);

    expect(named('lp612.render.failed')).toHaveLength(1);
    expect(named('lp612.render.failed')[0][1]).toMatchObject({
      segmentId: 'seg-1',
      renderId: 'render-9',
      lang: 'en',
      phase: 'gate',
      correlationId: 'corr-render',
      problems: ['PAGE COUNT: support needs 6 pages; the cap is 4.'],
    });
  });

  test('a renderer that blows up for its own reasons is still a named failure event', async () => {
    mockRenderDoc.mockRejectedValue(new Error('browser would not launch'));

    await expect(renderLessonPlan({
      lpDoc: { lesson_id: 'x' }, stem: 'seg_x', outDir: outDir(), correlationId: 'c',
      segmentId: 'seg-1', renderId: 'render-9',
    })).rejects.toThrow(/failed/);

    expect(named('lp612.render.failed')).toHaveLength(1);
    expect(named('lp612.render.failed')[0][1]).toMatchObject({ segmentId: 'seg-1', renderId: 'render-9' });
  });

  test('phase defaults to "final" so an un-updated caller is never mislabelled as a gate run', async () => {
    mockRenderDoc.mockResolvedValue({
      pdfPath: '/tmp/a.pdf', pdfPages: 2, pagesByPart: {}, problems: [], warnings: [], report: {},
    });
    await renderLessonPlan({ lpDoc: { lesson_id: 'x' }, stem: 's', outDir: outDir() });
    expect(named('lp612.render.completed')[0][1].phase).toBe('final');
  });
});
