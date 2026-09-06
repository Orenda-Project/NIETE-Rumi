/**
 * bd-w65g9 — Anthropic prompt caching on the lp612 author ladder.
 *
 * Measured on real prod telemetry (2026-09-06, 12 lessons / 68 calls): mean $0.843/lesson,
 * 5.7 calls/lesson, ~48,668 prompt tokens each, `cached_tokens: 0` on every call. The system
 * brief alone measures 37,536 tokens — 77% of the average prompt — and is byte-identical on
 * every call of a lesson. Nothing was ever sent to make it cacheable.
 *
 * Caching is a PREFIX MATCH: any byte change anywhere in the prefix invalidates everything
 * after it, and the render order is tools -> system -> messages. So the property that actually
 * has to hold is not "a marker was attached" but "the bytes ahead of the marker are identical
 * on call 2 as on call 1". Test 4 is that property, asserted across a real ladder run.
 *
 * Two breakpoints, deliberately separable:
 *   BP1  the system message (`authorBrief`) — transport wrapping only, prompt bytes IDENTICAL.
 *   BP2  `originalUser` hoisted to the FRONT of the revision turn — the only change that moves
 *        a prompt byte, and therefore the only one the staging A/B has to clear on quality.
 *
 * Flag OFF must be byte-for-byte today's behaviour (plain-string content, originalUser last).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const mockLogEvent = jest.fn();
const mockLogToFile = jest.fn();

jest.mock('../../bot/shared/services/llm-client', () => {
  const create = jest.fn();
  return { getClient: () => ({ chat: { completions: { create } } }), __create: create };
});
jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: (...a) => mockLogToFile(...a), logError: jest.fn(), logWarn: jest.fn(),
}));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (...a) => mockLogEvent(...a), getCurrentCorrelationId: () => undefined,
}));

const create = require('../../bot/shared/services/llm-client').__create;
const { authorLessonPlan, buildRevisionPrompt } =
  require('../../bot/shared/services/lp612-author.service');
const CLEAN_DOC = require('./__fixtures__/v9_gate_base.lp.json');

const BOOK = { title: 'Biology 9', publisher: 'PCTB', subject: 'biology', grade: 9, medium: 'en', language: 'English', offset: 4 };
const TOC = { chapters: [{ number: 1, title: 'The Biological Method', printed_start: 9 }] };
const SEGMENT = {
  segment_id: 'seg-1', book_stem: 'grade_9_biology', grade: 9, subject: 'biology',
  medium: 'en', language: 'English', chapter_number: 1, chapter_title: 'The Biological Method',
  chapter_key: 'g9-bio-ch1', subtopic_title: 'Observation and hypothesis',
  menu_title: 'Observation & hypothesis', printed_page_start: 11, printed_page_end: 12,
  pages_covered: [11, 12], order_index: 3, lp_type: 'SCI-9-10', yt: null, notes: null,
};
const reply = (obj) => ({
  choices: [{ message: { content: JSON.stringify(obj) } }],
  usage: { prompt_tokens: 111, completion_tokens: 222, total_tokens: 333 },
});
const CLIPPED_A = 'OVERFLOW on s2: content is 40px taller than the page. Offending: exam_bank (+40px)';

/** The bytes the provider actually receives for one role, marker or no marker. */
const textOf = (content) =>
  (typeof content === 'string' ? content : content.map((b) => b.text).join(''));
const blocksOf = (content) => (typeof content === 'string' ? null : content);
const callsOf = () => create.mock.calls.map((c) => c[0]);

let dir;
beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.LP612_PROMPT_CACHE;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-cache-'));
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
  delete process.env.LP612_PAGE_TRUTH_DIR;
  delete process.env.LP612_PROMPT_CACHE;
});

async function runLadder() {
  const renderCheck = jest.fn()
    .mockResolvedValueOnce([CLIPPED_A])   // round-0 gate: one blocking defect -> forces a revision
    .mockResolvedValueOnce([]);           // round-1 candidate: clean
  create.mockResolvedValue(reply(CLEAN_DOC));
  return authorLessonPlan({
    segment: SEGMENT, lang: 'en', model: 'test/model', rounds: 3,
    renderCheck, correlationId: 'corr-cache',
  });
}

// ── 1. flag OFF is today, byte for byte ─────────────────────────────────────

test('flag OFF: content stays a plain string on both roles and no cache_control is sent', async () => {
  await runLadder();
  expect(create.mock.calls.length).toBeGreaterThanOrEqual(2);
  for (const p of callsOf()) {
    expect(typeof p.messages[0].content).toBe('string');
    expect(typeof p.messages[1].content).toBe('string');
    expect(JSON.stringify(p)).not.toContain('cache_control');
  }
});

test('flag OFF: buildRevisionPrompt still ends with the original task (unchanged ordering)', () => {
  const out = buildRevisionPrompt({
    doc: JSON.parse(JSON.stringify(CLEAN_DOC)),
    gates: { schema: [], lint: [], render: [CLIPPED_A], warns: [] },
    originalUser: 'ORIGINAL-TASK-SENTINEL', notes: null, lang: 'en',
  });
  expect(out.trimEnd().endsWith('ORIGINAL-TASK-SENTINEL')).toBe(true);
});

// ── 2. BP1 — the system message carries a breakpoint, and its BYTES do not move ──

test('flag ON: system message carries exactly one ephemeral cache_control breakpoint', async () => {
  process.env.LP612_PROMPT_CACHE = 'true';
  await runLadder();
  for (const p of callsOf()) {
    const blocks = blocksOf(p.messages[0].content);
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('text');
    expect(blocks[0].cache_control).toEqual({ type: 'ephemeral' });
  }
});

test('BP1 is transport-only: the system TEXT is byte-identical with the flag on and off', async () => {
  await runLadder();
  const off = callsOf().map((p) => textOf(p.messages[0].content));
  jest.clearAllMocks();
  process.env.LP612_PROMPT_CACHE = 'true';
  await runLadder();
  const on = callsOf().map((p) => textOf(p.messages[0].content));
  expect(on).toEqual(off);
});

// ── 3. BP2 — the stable task leads the revision turn and carries a breakpoint ──

test('flag ON: the revision user turn LEADS with the original task, marked cacheable', async () => {
  process.env.LP612_PROMPT_CACHE = 'true';
  await runLadder();
  const revision = callsOf()[1];
  const blocks = blocksOf(revision.messages[1].content);
  expect(Array.isArray(blocks)).toBe(true);
  expect(blocks.length).toBeGreaterThanOrEqual(2);
  expect(blocks[0].cache_control).toEqual({ type: 'ephemeral' });
  // the volatile tail must NOT be marked
  expect(blocks[blocks.length - 1].cache_control).toBeUndefined();
  // and it must still carry the defect the round exists to fix
  expect(textOf(revision.messages[1].content)).toContain('OVERFLOW on s2');
});

// ── 4. THE PROPERTY THAT MAKES A CACHE HIT POSSIBLE ─────────────────────────
// Not "a marker is present" but "the bytes ahead of it repeat". If this fails, every
// request writes a new entry and reads nothing — the silent-invalidator failure mode.

test('flag ON: the cached prefix is byte-identical between round 0 and the revision round', async () => {
  process.env.LP612_PROMPT_CACHE = 'true';
  await runLadder();
  const [round0, revision] = callsOf();

  // BP1: same system bytes
  expect(textOf(round0.messages[0].content)).toBe(textOf(revision.messages[0].content));

  // BP2: the revision's first (marked) user block must repeat round 0's whole user turn
  const r0User = textOf(round0.messages[1].content);
  const revBlocks = blocksOf(revision.messages[1].content);
  expect(revBlocks[0].text).toBe(r0User);
});

test('flag ON: no volatile content leaks ahead of a breakpoint', async () => {
  process.env.LP612_PROMPT_CACHE = 'true';
  await runLadder();
  const revision = callsOf()[1];
  const cached = blocksOf(revision.messages[1].content)[0].text;
  // the previous candidate and the defect list are per-round; they must sit AFTER the marker
  expect(cached).not.toContain('=== PREVIOUS lp_doc ===');
  expect(cached).not.toContain('OVERFLOW on s2');
});

// ── 5. the saving has to be VISIBLE, or it cannot be verified in prod ───────
// A cached call reports the SAME prompt_tokens as an uncached one — the tokens were processed,
// just billed at 0.1x. Without cost + the cached/write split there is no way to tell from
// telemetry whether caching worked, which is the silent-regression shape this lane exists to fix.

test('the completed event carries cost and the cached/write split, not just token totals', async () => {
  process.env.LP612_PROMPT_CACHE = 'true';
  const renderCheck = jest.fn()
    .mockResolvedValueOnce([CLIPPED_A])
    .mockResolvedValueOnce([]);
  create
    .mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify(CLEAN_DOC) } }],
      usage: {
        prompt_tokens: 40000, completion_tokens: 8000, total_tokens: 48000, cost: 0.0939,
        prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 37536 },
      },
    })
    .mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify(CLEAN_DOC) } }],
      usage: {
        prompt_tokens: 42000, completion_tokens: 8000, total_tokens: 50000, cost: 0.0075,
        prompt_tokens_details: { cached_tokens: 37536, cache_write_tokens: 0 },
      },
    });

  const out = await authorLessonPlan({
    segment: SEGMENT, lang: 'en', model: 'test/model', rounds: 3,
    renderCheck, correlationId: 'corr-usage',
  });

  expect(out.usage).toMatchObject({
    calls: 2,
    cached_tokens: 37536,
    cache_write_tokens: 37536,
  });
  // the flag belongs on the EVENT, not on the usage totals
  expect(out.usage).not.toHaveProperty('promptCache');
  expect(out.usage.cost_usd).toBeCloseTo(0.1014, 6);

  const completed = mockLogEvent.mock.calls.filter((c) => c[0] === 'lp612.author.completed');
  expect(completed).toHaveLength(1);
  expect(completed[0][1]).toMatchObject({
    cachedTokens: 37536, cacheWriteTokens: 37536, promptCache: true,
  });
  expect(completed[0][1].costUsd).toBeCloseTo(0.1014, 6);
});

test('usage accumulation is safe when the provider sends no cost or cache details', async () => {
  await runLadder();   // the default reply() carries neither `cost` nor prompt_tokens_details
  const completed = mockLogEvent.mock.calls.filter((c) => c[0] === 'lp612.author.completed');
  expect(completed[0][1]).toMatchObject({
    costUsd: 0, cachedTokens: 0, cacheWriteTokens: 0, promptCache: false,
  });
});
