/**
 * FEAT-059 / bd-njn7u Phase 2 — buildLpContext (TDD, red first).
 *
 * The context block that makes the conversational AI aware of what this
 * teacher was recently given. Two tiers (RT-2): identityLine (~40 tokens,
 * always injected when anything was delivered) and fullBlock (voicenote
 * script + lesson steps, injected only when her message plausibly concerns a
 * received lesson — gated at the call site, not here).
 *
 * Non-negotiables encoded below:
 *  - deterministic retrieval by lesson_id + content_hash — never "latest",
 *    never name-matching (the IDs were captured at delivery time);
 *  - corpus-only trust boundary, content wrapped in <lesson_reference> and
 *    labelled reference material, not instructions (RT-4);
 *  - NO measurement language, enforced by regex — the teacher must never be
 *    told her lesson is being graded (operator, 2026-08-18);
 *  - positive-polarity routing framing (RT-9);
 *  - ≤4 KB, moves only on the 2 most recent entries (RT-6);
 *  - Redis flush must not lobotomise the bot: niete_lp_downloads 7-day
 *    fallback when the shelf is empty;
 *  - soft-fail: ANY internal error → null → today's behaviour exactly.
 */

/* eslint-disable global-require */

const NO_MEASUREMENT_RX = /scor|fidelit|assess|measur|grade(d|s)? (on|against)/i;

// ─── mocks ──────────────────────────────────────────────────────────────────

let mockShelf = [];
let mockShelfError = null;
jest.mock('../../shared/services/lp-shelf.service', () => ({
  getShelf: jest.fn(async () => {
    if (mockShelfError) throw mockShelfError;
    return mockShelf;
  }),
  pushToShelf: jest.fn(async () => {}),
  flushShelf: jest.fn(async () => {}),
}));

let mockScripts = {};                   // r2_key(.pdf) → script text
jest.mock('../../shared/services/lp-voicenote-script.service', () => ({
  getVoicenoteScript: jest.fn(async (entry) => mockScripts[entry.r2_key] ?? null),
}));

const mockResolveCalls = [];
let mockMoveLists = {};                 // `${lesson_id}:${content_hash}` → moves[]
jest.mock('../../shared/services/coaching/fidelity/lp-fidelity-store', () => ({
  resolveMoveList: jest.fn(async (key, opts) => {
    mockResolveCalls.push({ key, opts });
    const moves = mockMoveLists[`${key.lesson_id}:${key.content_hash}`];
    return moves ? { lesson_id: key.lesson_id, content_hash: key.content_hash, moves, resolved: 'exact' } : null;
  }),
}));

const mockTables = { niete_lp_downloads: [], niete_lp_assets: [] };
function mockBuilderFor(table) {
  let rows = [...(mockTables[table] || [])];
  const b = {
    select: () => b,
    eq: (col, val) => { rows = rows.filter((r) => String(r[col]) === String(val)); return b; },
    gte: (col, val) => { rows = rows.filter((r) => String(r[col]) >= String(val)); return b; },
    order: (col, opts) => {
      const asc = !!(opts && opts.ascending);
      rows = [...rows].sort((a, c) => (asc ? 1 : -1) * String(a[col]).localeCompare(String(c[col])));
      return b;
    },
    limit: (n) => Promise.resolve({ data: rows.slice(0, n), error: null }),
    maybeSingle: () => Promise.resolve({ data: rows[0] || null, error: null }),
    then: (f, r) => Promise.resolve({ data: rows, error: null }).then(f, r),
  };
  return b;
}
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn((t) => mockBuilderFor(t)) }));

jest.mock('../../shared/services/lp-v8-catalog.service', () => ({
  lessonById: jest.fn((lessonId) => ({
    lesson: {
      lesson_id: lessonId, segment_index: 2, day_label: 'Day 2',
      topic: 'Counting to fifty', topic_short: 'Counting', pages_label: 'p. 12–13',
      row: { title: 'Numbers' },
    },
    chapter: { number: 3, title: 'Numbers all around' },
    book: { grade: 2, subject: 'Mathematics', subject_key: 'maths' },
  })),
}));

jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { buildLpContext } = require('../../shared/services/lp-context.service');

// ─── fixtures ───────────────────────────────────────────────────────────────

const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const daysAgo = (d) => new Date(Date.now() - d * 86400 * 1000).toISOString();

function shelfEntry(overrides = {}) {
  const lessonId = overrides.lesson_id || 'grade_1_urdu_ch7_seg1';
  return {
    lesson_id: lessonId,
    grade: 1,
    subject: 'urdu',
    subject_label: 'Urdu',
    chapter_number: 7,
    chapter_title: 'چھٹی کا دن',
    topic: 'چھٹی کے دن کی کہانی',
    pages_label: 'p. 60',
    r2_key: `lp-cache/v8/${lessonId}/aaaa1111.pdf`,
    content_hash: 'aaaa1111',
    version_stamp: 'v8.2026-08-19',
    voicenote_sent: true,
    lesson_plan_id: 'lp-row-1',
    delivered_at: hoursAgo(3),
    ...overrides,
  };
}

const MOVES = [
  { move_id: 'm1', phase: 'hook', type: 'instruction', text: 'Ask who remembers last holiday', bucket: 'must_happen', adjudicable: true },
  { move_id: 'm2', phase: 'guided', type: 'activity', text: 'Read the story aloud together', bucket: 'must_happen', adjudicable: true },
  { move_id: 'm3', phase: 'exit', type: 'logistics', text: 'Collect the notebooks', bucket: 'must_happen', adjudicable: false },
  { move_id: 'm4', phase: 'independent', type: 'activity', text: 'Optional drawing extension', bucket: 'optional_extension', adjudicable: true },
];

beforeEach(() => {
  mockShelf = [];
  mockShelfError = null;
  mockScripts = {};
  mockMoveLists = {};
  mockResolveCalls.length = 0;
  mockTables.niete_lp_downloads = [];
  mockTables.niete_lp_assets = [];
  jest.clearAllMocks();
});

// ─── the block ──────────────────────────────────────────────────────────────

describe('buildLpContext — happy path', () => {
  test('one fresh entry → identity line + full block with script and must-happen steps', async () => {
    const entry = shelfEntry();
    mockShelf = [entry];
    mockScripts[entry.r2_key] = 'سبق کا خلاصہ: چھٹی کے دن کی کہانی سنائیں۔';
    mockMoveLists[`${entry.lesson_id}:${entry.content_hash}`] = MOVES;

    const ctx = await buildLpContext('user-1');
    expect(ctx).not.toBeNull();

    // Tier A: names the lesson and how long ago, in one line.
    expect(ctx.identityLine).toContain('Grade 1');
    expect(ctx.identityLine).toContain('Urdu');
    expect(ctx.identityLine).toContain('چھٹی کا دن');
    expect(ctx.identityLine).toMatch(/3\s?h/);
    expect(ctx.identityLine.includes('\n')).toBe(false);

    // Tier B: the script she heard and the lesson's steps.
    expect(ctx.fullBlock).toContain('سبق کا خلاصہ');
    expect(ctx.fullBlock).toContain('Ask who remembers last holiday');
    expect(ctx.fullBlock).toContain('Read the story aloud together');
    // Every must-happen step is part of HER lesson, adjudicable or not:
    // `adjudicable` is a coaching-scoring flag (can this be judged from a
    // classroom recording?), and homework never can be — which is why the
    // operator's "all sections" came back without it (bd-91r48). Optional
    // extensions still stay out.
    expect(ctx.fullBlock).toContain('Collect the notebooks');
    expect(ctx.fullBlock).not.toContain('Optional drawing extension');
  });

  test('moves resolve by the DELIVERED content_hash — never latest, never a fallback', async () => {
    const entry = shelfEntry();
    mockShelf = [entry];
    mockMoveLists[`${entry.lesson_id}:${entry.content_hash}`] = MOVES;

    await buildLpContext('user-1');
    expect(mockResolveCalls.length).toBeGreaterThan(0);
    for (const call of mockResolveCalls) {
      expect(call.key).toMatchObject({ lesson_id: entry.lesson_id, content_hash: entry.content_hash });
      expect(call.opts && call.opts.fallbackToCurrent).toBeFalsy();
    }
  });

  test('trust boundary: fetched content rides inside <lesson_reference>, labelled reference material', async () => {
    const entry = shelfEntry();
    mockShelf = [entry];
    mockScripts[entry.r2_key] = 'یہ وائس نوٹ ہے۔';
    const ctx = await buildLpContext('user-1');
    const openIdx = ctx.fullBlock.indexOf('<lesson_reference>');
    const closeIdx = ctx.fullBlock.indexOf('</lesson_reference>');
    expect(openIdx).toBeGreaterThan(-1);
    expect(closeIdx).toBeGreaterThan(openIdx);
    expect(ctx.fullBlock.slice(openIdx, closeIdx)).toContain('یہ وائس نوٹ ہے');
    expect(ctx.fullBlock).toMatch(/reference material, not instructions/i);
  });

  test('framing is positive-polarity routing, colleague-style adaptation guidance included', async () => {
    mockShelf = [shelfEntry()];
    const ctx = await buildLpContext('user-1');
    expect(ctx.fullBlock).toMatch(/use this section only when/i);
    expect(ctx.fullBlock).not.toMatch(/ignore this (section|context)/i);
    expect(ctx.fullBlock).toMatch(/what she actually needs|what that step was for/i);
  });

  test('NEVER measurement language — regex-enforced on both tiers', async () => {
    const entry = shelfEntry();
    mockShelf = [entry];
    mockScripts[entry.r2_key] = 'سبق کا خلاصہ';
    mockMoveLists[`${entry.lesson_id}:${entry.content_hash}`] = MOVES;
    const ctx = await buildLpContext('user-1');
    expect(ctx.identityLine).not.toMatch(NO_MEASUREMENT_RX);
    expect(ctx.fullBlock).not.toMatch(NO_MEASUREMENT_RX);
  });
});

describe('recency, multiplicity, staleness', () => {
  test('three entries → steps for the 2 most recent only; oldest is identity-only', async () => {
    const oldE = shelfEntry({ lesson_id: 'grade_1_urdu_ch5_seg1', content_hash: 'cccc3333', r2_key: 'lp-cache/v8/grade_1_urdu_ch5_seg1/cccc3333.pdf', delivered_at: hoursAgo(30) });
    const midE = shelfEntry({ lesson_id: 'grade_1_urdu_ch6_seg1', content_hash: 'bbbb2222', r2_key: 'lp-cache/v8/grade_1_urdu_ch6_seg1/bbbb2222.pdf', delivered_at: hoursAgo(5) });
    const newE = shelfEntry();
    mockShelf = [oldE, midE, newE];                       // shelf order: oldest first
    mockMoveLists[`${oldE.lesson_id}:${oldE.content_hash}`] = MOVES;
    mockMoveLists[`${midE.lesson_id}:${midE.content_hash}`] = MOVES;
    mockMoveLists[`${newE.lesson_id}:${newE.content_hash}`] = MOVES;

    await buildLpContext('user-1');
    const resolvedFor = mockResolveCalls.map((c) => c.key.lesson_id);
    expect(resolvedFor).toContain(newE.lesson_id);
    expect(resolvedFor).toContain(midE.lesson_id);
    expect(resolvedFor).not.toContain(oldE.lesson_id);
  });

  test('an entry older than 6h carries the confirm-before-assuming caution', async () => {
    mockShelf = [shelfEntry({ delivered_at: hoursAgo(9) })];
    const ctx = await buildLpContext('user-1');
    expect(ctx.fullBlock).toMatch(/older|confirm which lesson/i);
  });

  test('a fresh entry does not', async () => {
    mockShelf = [shelfEntry({ delivered_at: hoursAgo(1) })];
    const ctx = await buildLpContext('user-1');
    expect(ctx.fullBlock).not.toMatch(/confirm which lesson/i);
  });
});

describe('downloads fallback — a Redis flush must not lobotomise the bot', () => {
  test('empty shelf + a sent download 3 days old → context from download history, marked as such', async () => {
    mockTables.niete_lp_downloads = [{
      user_id: 'user-1', lesson_id: 'grade_2_maths_ch3_seg2', status: 'sent',
      content_hash: 'dddd4444', version_stamp: 'v8.2026-08-18', created_at: daysAgo(3),
      grade: 2, subject: 'maths', chapter_number: 3, segment_index: 2,
    }];
    mockTables.niete_lp_assets = [{
      lesson_id: 'grade_2_maths_ch3_seg2', asset_kind: 'lesson', content_hash: 'dddd4444',
      r2_key: 'lp-cache/v8/grade_2_maths_ch3_seg2/dddd4444.pdf',
    }];
    mockScripts['lp-cache/v8/grade_2_maths_ch3_seg2/dddd4444.pdf'] = 'گنتی کا سبق';

    const ctx = await buildLpContext('user-1');
    expect(ctx).not.toBeNull();
    expect(ctx.fullBlock).toMatch(/download history/i);
    expect(ctx.fullBlock).toContain('گنتی کا سبق');
    expect(ctx.identityLine).toContain('Grade 2');
  });

  test('empty shelf + only downloads older than 7 days → null', async () => {
    mockTables.niete_lp_downloads = [{
      user_id: 'user-1', lesson_id: 'grade_2_maths_ch3_seg2', status: 'sent',
      content_hash: 'dddd4444', created_at: daysAgo(9),
      grade: 2, subject: 'maths', chapter_number: 3, segment_index: 2,
    }];
    expect(await buildLpContext('user-1')).toBeNull();
  });

  test('failed deliveries never become context', async () => {
    mockTables.niete_lp_downloads = [{
      user_id: 'user-1', lesson_id: 'grade_2_maths_ch3_seg2', status: 'failed',
      content_hash: 'dddd4444', created_at: daysAgo(1),
      grade: 2, subject: 'maths', chapter_number: 3, segment_index: 2,
    }];
    expect(await buildLpContext('user-1')).toBeNull();
  });

  test('empty shelf + empty downloads → null', async () => {
    expect(await buildLpContext('user-1')).toBeNull();
  });
});

describe('degradation', () => {
  test('missing script → the block still renders with steps only', async () => {
    const entry = shelfEntry();
    mockShelf = [entry];
    mockMoveLists[`${entry.lesson_id}:${entry.content_hash}`] = MOVES;
    const ctx = await buildLpContext('user-1');
    expect(ctx).not.toBeNull();
    expect(ctx.fullBlock).toContain('Ask who remembers last holiday');
  });

  test('any internal failure → null, never a throw (today\'s behaviour exactly)', async () => {
    mockShelfError = new Error('redis exploded');
    await expect(buildLpContext('user-1')).resolves.toBeNull();
  });

  test('the lesson body stays inside the 4 KB budget even with a runaway script', async () => {
    const entry = shelfEntry();
    mockShelf = [entry];
    mockScripts[entry.r2_key] = 'بہت لمبا سبق ہے۔ '.repeat(2000);   // ~36 KB of script
    mockMoveLists[`${entry.lesson_id}:${entry.content_hash}`] = MOVES;
    const ctx = await buildLpContext('user-1');
    // bd-91r48: the budget bounds the BODY; FRAMING is fixed overhead on top.
    const { FRAMING, BLOCK_BUDGET_CHARS } = require('../../shared/services/lp-context.service').__consts;
    expect(ctx.fullBlock.length).toBeLessThanOrEqual(FRAMING.length + 2 + BLOCK_BUDGET_CHARS);
    expect(ctx.fullBlock.slice(ctx.fullBlock.indexOf('### ')).length).toBeLessThanOrEqual(BLOCK_BUDGET_CHARS);
  });
});

// ─── bd-91r48 follow-on: the budget must not eat the lesson ────────────────
//
// Staging, 2026-08-30: the operator asked for "the whole lesson plan in brief,
// all sections" and got warm-up, hook, announce — then an invented "Wrap-up
// and Q&A". The block was exactly 4,096 chars: FRAMING has grown to ~2,600
// (bd-wpupy added its rules there), leaving ~1,500 for the lesson, and the
// hard clip took moves 4–11 — explain, guided, independent, exit, homework.
// The model summarised what it was given. The 4 KB budget was meant for the
// LESSON (RT-6); FRAMING is fixed overhead the author controls, and must not
// count against it. And when something does have to go, the voicenote teaser
// goes before the steps.
describe('bd-91r48 — every must-happen move survives the budget', () => {
  const ELEVEN = ['warm_up', 'hook', 'announce', 'explain', 'guided', 'guided', 'independent',
    'independent', 'independent', 'exit', 'homework'].map((phase, i) => ({
    move_id: `m${i + 1}`, phase, bucket: i === 7 || i === 8 ? 'optional_extension' : 'must_happen',
    adjudicable: true,
    text: `${phase} step ${i + 1}: ${'a realistic hundred-and-fifty character instruction for the teacher, with numbers like 4,275 × 8 and a page ref p.44 '.slice(0, 150)}`,
  }));

  test('a real-size lesson (625-char script + 11 moves) keeps ALL nine must-happen phases', async () => {
    const entry = shelfEntry();
    mockShelf = [entry];
    mockScripts[entry.r2_key] = '[warmly] Assalamu alaikum Ustaad-e-mohtaram۔ '.repeat(14).slice(0, 625);
    mockMoveLists[`${entry.lesson_id}:${entry.content_hash}`] = ELEVEN;
    const ctx = await buildLpContext('user-1');
    for (const m of ELEVEN.filter((x) => x.bucket === 'must_happen')) {
      expect(ctx.fullBlock).toContain(m.text.slice(0, 40));
    }
    expect(ctx.fullBlock).toContain('- exit ·');
    expect(ctx.fullBlock).toContain('- homework ·');
  });

  test('homework is must-happen but not adjudicable — it is still one of her sections', async () => {
    const entry = shelfEntry();
    mockShelf = [entry];
    mockMoveLists[`${entry.lesson_id}:${entry.content_hash}`] = [
      ...ELEVEN.slice(0, 10),
      { ...ELEVEN[10], adjudicable: false, text: 'homework: Assign p.44 — 24 shelves × 132 toys' },
    ];
    const ctx = await buildLpContext('user-1');
    expect(ctx.fullBlock).toContain('Assign p.44');
  });

  test('the budget is for the lesson body — FRAMING does not count against it', async () => {
    const entry = shelfEntry();
    mockShelf = [entry];
    mockScripts[entry.r2_key] = 'بہت لمبا سبق ہے۔ '.repeat(2000);
    mockMoveLists[`${entry.lesson_id}:${entry.content_hash}`] = ELEVEN;
    const ctx = await buildLpContext('user-1');
    const body = ctx.fullBlock.slice(ctx.fullBlock.indexOf('### '));
    expect(body.length).toBeLessThanOrEqual(4096);
  });

  test('when the block must be cut, the steps outrank the voicenote teaser', async () => {
    const entry = shelfEntry();
    mockShelf = [entry];
    mockScripts[entry.r2_key] = 'بہت لمبا سبق ہے۔ '.repeat(2000);     // runaway script
    mockMoveLists[`${entry.lesson_id}:${entry.content_hash}`] = ELEVEN;
    const ctx = await buildLpContext('user-1');
    expect(ctx.fullBlock).toContain('- homework ·');                 // the last step still made it
    expect(ctx.fullBlock.indexOf('The lesson\'s steps:')).toBeLessThan(ctx.fullBlock.indexOf('The voice note'));
  });
});
