/**
 * bd-jddcu — runGates SHORT-CIRCUITS on a schema failure (by design — see runGates), which
 * means a schema-invalid gate result carries ONLY schema errors: lint and the render probe
 * never ran on it, so they never got the chance to add their own defects to its count. A
 * schema-VALID candidate, by contrast, is scored on the FULL gate set.
 *
 * `notWorse` compared the two on raw defect count, which can only ever favour the undercounted
 * (broken) side. Live case, today's coach test: a lesson failed
 *
 *   SCHEMA INVALID — refusing to render: /sections/1/blocks/2 must have required property
 *   'text'; must NOT have additional properties ('ref')
 *
 * after burning 332 seconds — a schema-broken candidate reached the renderer at all, which means
 * the ladder had, at some point, PREFERRED a schema-broken document over one that could render.
 *
 * THE FIX: schema validity is a hard tier, checked ahead of the existing defect-count
 * comparison, in both places this file compares a candidate to an incumbent — the authoring
 * ladder's `notWorse` AND the edit lane's `blockingCost(g2) <= bar` acceptance check (identical
 * vulnerability, found while fixing the first: an edit that broke schema could still read as
 * "no worse" than the document she already had, by the same undercount).
 *
 * Driven through the real `authorLessonPlan`/`reviseLessonPlan` — `notWorse`/`runGates` are not
 * exported, and exporting them just to unit-test in isolation would stop testing the thing that
 * actually broke: the ladder's own control flow. Only the LLM is mocked, at the network boundary
 * (`llm-client`); schema validation and lint run for real (through the root suite's ajv/katex
 * stubs — checked against the real packages, see author.test.js's note).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const mockLogEvent = jest.fn();

jest.mock('../../bot/shared/services/llm-client', () => {
  const create = jest.fn();
  return { getClient: () => ({ chat: { completions: { create } } }), __create: create };
});
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (...a) => mockLogEvent(...a),
  getCurrentCorrelationId: () => undefined,
}));

const create = require('../../bot/shared/services/llm-client').__create;
const { authorLessonPlan, reviseLessonPlan } = require('../../bot/shared/services/lp612-author.service');
const CLEAN_DOC = require('./__fixtures__/v9_gate_base.lp.json');

const clone = (d) => JSON.parse(JSON.stringify(d));
const named = (name) => mockLogEvent.mock.calls.filter((c) => c[0] === name);

/**
 * The clean fixture with ONE paragraph block broken exactly the way the coach-test lesson was:
 * its required `text` removed, an unknown property added. `sections[1].blocks[0]` (development's
 * `close-hook` paragraph) is confirmed schema-clean and untouched by any sanitiser that runs
 * before the gate (sanitizeUnknownTopLevel only strips unknown TOP-LEVEL keys), so this produces
 * exactly one SCHEMA defect and nothing else.
 */
function schemaBrokenDoc() {
  const d = clone(CLEAN_DOC);
  const block = d.sections[1].blocks[0];
  delete block.text;
  block.ref = 'X1';
  return d;
}

const BOOK = { title: 'Biology 9', publisher: 'PCTB', subject: 'biology', grade: 9, medium: 'en', language: 'English', offset: 4 };
const TOC = { chapters: [{ number: 1, title: 'The Biological Method', printed_start: 9 }] };
const SEGMENT = {
  segment_id: 'seg-1', book_stem: 'grade_9_biology', grade: 9, subject: 'biology',
  medium: 'en', language: 'English', chapter_number: 1, chapter_title: 'The Biological Method',
  chapter_key: 'g9-bio-ch1', subtopic_title: 'Observation and hypothesis',
  menu_title: 'Observation & hypothesis', printed_page_start: 11, printed_page_end: 12,
  pages_covered: [11, 12], order_index: 3, lp_type: 'SCI-9-10', yt: null,
};

const reply = (obj) => ({
  choices: [{ message: { content: typeof obj === 'string' ? obj : JSON.stringify(obj) } }],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
});

// Three independent RENDER defects, so the schema-valid candidate's blocking cost (3) reads
// numerically higher than the schema-broken candidate's (1 schema error) under a raw count —
// which is exactly the comparison that must no longer decide the outcome.
const RENDER_DEFECTS = [
  'PAGE COUNT: support needs 6 pages; the cap is 4.',
  'PAGE COUNT: teach needs 6 pages; the cap is 4.',
  'OVERFLOW on s2: content is 40px taller than the page.',
];

let dir;
beforeEach(() => {
  jest.clearAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-schema-tier-'));
  const d = path.join(dir, SEGMENT.book_stem);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, '_book.json'), JSON.stringify(BOOK));
  fs.writeFileSync(path.join(d, '_toc.json'), JSON.stringify(TOC));
  for (const n of [11, 12]) {
    fs.writeFileSync(path.join(d, `pg_${String(n).padStart(3, '0')}.json`), JSON.stringify({
      printed_page_number: n, pdf_page_index: n + 4, page_type: 'content',
      blocks: [{ t: 'heading', text: `1.${n} Observation` }],
    }));
  }
  process.env.LP612_PAGE_TRUTH_DIR = dir;
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.LP612_PAGE_TRUTH_DIR;
});

const run = (renderCheck, rounds = 1) => authorLessonPlan({
  segment: SEGMENT, lang: 'en', model: 'test/model', rounds, renderCheck, correlationId: 'corr-1',
});

describe('the authoring ladder never prefers a schema-invalid candidate (bd-jddcu)', () => {
  test('THE KILLER CASE: a schema-invalid revision with 1 defect does not displace a schema-valid document carrying 3', async () => {
    const renderCheck = jest.fn().mockResolvedValue(RENDER_DEFECTS);
    create
      .mockResolvedValueOnce(reply(CLEAN_DOC))          // round 0: schema-valid, 3 render defects
      .mockResolvedValueOnce(reply(schemaBrokenDoc())); // round 1: schema-invalid, 1 defect

    const out = await run(renderCheck, 1);

    // The kept document must still be the schema-valid one. If the candidate had won, `fails`
    // would carry a `SCHEMA:` line instead of the three RENDER lines.
    expect(out.fails.some((f) => f.startsWith('SCHEMA:'))).toBe(false);
    expect(out.fails).toEqual(expect.arrayContaining(RENDER_DEFECTS));
    expect(out.fails).toHaveLength(RENDER_DEFECTS.length);

    // The short-circuit must still hold for the REJECTED candidate too: lint/render never had
    // the chance to run on it, so renderCheck is called exactly once — for the kept document's
    // own gate, never for the schema-broken candidate's.
    expect(renderCheck).toHaveBeenCalledTimes(1);
  });

  test('the reverse direction still works: a schema-valid revision beats a schema-invalid original', async () => {
    // Guards against a tiering bug that only fires one way. If round 0 itself is broken, the
    // revision that actually validates must always be taken, however many lint/render defects
    // it happens to carry.
    const renderCheck = jest.fn().mockResolvedValue(RENDER_DEFECTS);
    create
      .mockResolvedValueOnce(reply(schemaBrokenDoc())) // round 0: schema-invalid, 1 defect
      .mockResolvedValueOnce(reply(CLEAN_DOC));        // round 1: schema-valid, 3 render defects

    const out = await run(renderCheck, 1);

    expect(out.fails.some((f) => f.startsWith('SCHEMA:'))).toBe(false);
    expect(out.fails).toEqual(expect.arrayContaining(RENDER_DEFECTS));
  });

  test('within the same tier, fewer schema errors still wins (unchanged behaviour)', async () => {
    // Two schema-invalid candidates: neither can ever be preferred over a valid one (there is
    // none here), but between themselves the old lexicographic rule must still apply — the tier
    // check must not swallow the existing within-tier comparison.
    // A second, independent schema break stacked on top of the first: 2 defects total.
    const twoErrors = schemaBrokenDoc();
    delete twoErrors.lp_type; // a second, unrelated required-property failure at the top level

    const renderCheck = jest.fn().mockResolvedValue([]);
    create
      .mockResolvedValueOnce(reply(twoErrors))       // round 0: 2 schema errors
      .mockResolvedValueOnce(reply(schemaBrokenDoc())); // round 1: 1 schema error — improvement

    const out = await run(renderCheck, 1);

    expect(out.fails).toHaveLength(1);
    expect(out.fails[0]).toMatch(/^SCHEMA:/);
  });

  test('is loggable: every schema failure is counted, and a rejected candidate is counted separately', async () => {
    const renderCheck = jest.fn().mockResolvedValue(RENDER_DEFECTS);
    create
      .mockResolvedValueOnce(reply(CLEAN_DOC))
      .mockResolvedValueOnce(reply(schemaBrokenDoc()));

    await run(renderCheck, 1);

    // "Seen": every schema failure, whether or not it is ultimately kept.
    const seen = named('lp612.author.schema_invalid');
    expect(seen).toHaveLength(1);
    expect(seen[0][1]).toMatchObject({ correlationId: 'corr-1', segmentId: 'seg-1', round: 1, errorCount: 1 });

    // "Rejected": specifically, a candidate discarded BECAUSE it was schema-invalid while the
    // kept document was valid — distinct from an ordinary higher-defect-count rejection.
    const rejected = named('lp612.author.schema_candidate_rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0][1]).toMatchObject({ correlationId: 'corr-1', segmentId: 'seg-1', round: 1, lane: 'author' });
  });
});

// ── the edit lane has the identical vulnerability (found while fixing the ladder) ───────────

const runEdit = (renderCheck, rounds = 1) => reviseLessonPlan({
  doc: CLEAN_DOC, instruction: 'Make the hook shorter.', segment: SEGMENT, lang: 'en',
  model: 'test/model', rounds, renderCheck, correlationId: 'corr-edit',
});

describe('the edit lane never accepts a schema-invalid edit over the document she already has', () => {
  test('a schema-broken edit is rejected even though its raw defect count reads lower than the bar', async () => {
    // Her document (CLEAN_DOC) renders but is not perfectly clean: give it a render defect so
    // its bar is 1. The naive `blockingCost(g2) <= bar` check would ACCEPT a schema-invalid
    // candidate whose only defect is 1 schema error (1 <= 1) — even though it cannot render at
    // all, unlike the document she already has.
    const renderCheck = jest.fn().mockResolvedValue([RENDER_DEFECTS[0]]);
    create.mockResolvedValueOnce(reply(schemaBrokenDoc()));

    const out = await runEdit(renderCheck, 1);

    expect(out.accepted).toBe(false);
    expect(out.lpDoc).toEqual(CLEAN_DOC); // her original, untouched
  });
});
