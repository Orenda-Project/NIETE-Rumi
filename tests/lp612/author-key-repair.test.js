/**
 * bd-znzjqi — the plan writer repairs a misspelled field name instead of failing the teacher.
 *
 * Live, 18 Nov 2026 06:16Z: grade_7_geography.c01.p009-009 came back with `page2.coaching_lookfer`
 * in every round; the schema refused it each time, the render refused it, and she got no plan.
 * Driven through the real `authorLessonPlan` (harness copied from author-schema-tier.test.js);
 * only the LLM is mocked.
 */


const fs = require('fs');
const os = require('os');
const path = require('path');

const mockLogEvent = jest.fn();

jest.mock('../../bot/shared/services/llm-client', () => {
  const create = jest.fn();
  return { getClient: () => ({ chat: { completions: { create } } }),
    // bd-oak77.29: the author service resolves its client PER MODEL now, so the mock has to
    // state that half of llm-client's contract too. Same `create` spy either way — these
    // suites assert on the payload, not on which provider it went to.
    getClientForModel: (m) => ({ client: { chat: { completions: { create } } }, model: String(m || '') }),
    __create: create };
});
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (...a) => mockLogEvent(...a),
  getCurrentCorrelationId: () => undefined,
}));

const create = require('../../bot/shared/services/llm-client').__create;
const { authorLessonPlan } = require('../../bot/shared/services/lp612-author.service');
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


function misspelledDoc() {
  const d = clone(CLEAN_DOC);
  d.page2.coaching_lookfer = d.page2.coaching_lookfor;
  delete d.page2.coaching_lookfor;
  return d;
}

test('the live case: coaching_lookfer in every round still gives her a plan that passes the schema', async () => {
  const renderCheck = jest.fn().mockResolvedValue([]);
  create.mockResolvedValue(reply(misspelledDoc()));

  const out = await run(renderCheck, 2);

  expect(out.fails.filter((f) => f.startsWith('SCHEMA:'))).toEqual([]);
  expect(out.lpDoc.page2.coaching_lookfor).toEqual(CLEAN_DOC.page2.coaching_lookfor);
  expect('coaching_lookfer' in out.lpDoc.page2).toBe(false);
  expect(named('lp612.author.keys_repaired').length).toBeGreaterThan(0);
  expect(named('lp612.author.schema_invalid')).toHaveLength(0);
});
