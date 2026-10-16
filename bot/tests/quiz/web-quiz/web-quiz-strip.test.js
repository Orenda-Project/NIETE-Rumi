'use strict';
/**
 * The weekly health numbers of the web quiz Challenge (web-quiz-strip.js): the lines computable from the tables,
 * written to web_quiz_strip_weekly(week, line, cell, value, n). Lost readings use ATTEMPTED (scored + failed, swept
 * included) as the denominator; a practice row never enters a cell; writing a week twice gives the same rows.
 * Faked boundaries only: Supabase (the in-memory fake that applies filters) and the logger.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
// Redis (the reply-cap lines) is down here; those lines have their own suite (web-quiz-strip-identity.test.js).
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({ isAvailable: jest.fn(() => false), scanValues: jest.fn(async () => null) }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const Strip = require('../../../shared/services/quiz/web-quiz-strip');

const WEEK = '2026-W42';                       // Mon 12 Oct – Sun 18 Oct 2026, PKT
const IN = '2026-10-14T08:00:00Z';
const NOW = Date.parse('2026-10-19T06:00:00Z');
const RUNS = 'web_quiz_challenge_runs';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CLS = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const KEY = (r) => `child-voice/sandbox/kept/2026-10-01/${r}/read-1.webm`;

let n = 0;
const v2 = (extra) => {
  n += 1;
  return {
    id: `run-${n}`, student_id: extra.canonical_id || A, exercise: 'read', grade: 3, lang: 'ur', status: 'scored', created_at: IN,
    mode: 'check', bank_version: 'v3', form: 'G3', period_id: '2026-10', exposure_no: 1, band: 2, canonical_id: A,
    id_src: 'roster_pick', id_confidence: 'high', homonym_in_list: false, helped: 'self', record: true, meta: {}, score: { correct: 30 },
    ...extra,
  };
};
const checkRows = () => [
  v2({ canonical_id: A, class_id: CLS, helped: 'helped' }),
  v2({ canonical_id: B }),
  v2({ canonical_id: C }),
  v2({ canonical_id: A, status: 'failed', exposure_no: 2, record: false, meta: { reason: 'unheard' } }),
  v2({ canonical_id: B, status: 'failed', exposure_no: 2, record: false, meta: { fail_reason: 'stt_timeout', swept_at: IN } }),
  // a legacy row (no mode) this week: a play, nothing else
  { id: 'legacy-1', student_id: C, exercise: 'bigger', grade: 3, lang: 'ur', status: 'scored', created_at: IN, meta: {}, score: { correct: 8 } },
  // outside the week: ignored
  v2({ canonical_id: C, created_at: '2026-10-11T18:59:59Z', status: 'failed' }),
];
const practiceRows = () => [
  v2({ canonical_id: C, mode: 'practice', helped: 'helped', status: 'scored' }),
  v2({ canonical_id: C, mode: 'practice', status: 'failed', meta: { fail_reason: 'unknown' } }),
  v2({ canonical_id: C, mode: 'practice', status: 'scored', anchor_exposure_no: 1, anchor_block: 'A1' }),
];

// The roster rows the run rows' children stand on: the strip trusts id_confidence = 'high' only when the student
// row proves it (on a list, or merged into a roster row), so a test whose high rows must count seeds them.
const roster = () => [A, B, C].map((sid, i) => ({ id: sid, student_name: `${['Ali', 'Bilal', 'Sana'][i]} Sample`, list_id: 'list-1', merged_into: null, status: 'active' }));

let db;
const install = (runs, extra = {}) => {
  db = { [RUNS]: runs, web_quiz_strip_weekly: [], child_rungs: [], message_ledger: [], ...extra };
  Object.assign(supabase, makeFake(db, { uniques: { web_quiz_strip_weekly: ['week', 'line', 'cell'] } }));
};
const line = (name, cell = '') => db.web_quiz_strip_weekly.find((r) => r.line === name && r.cell === cell);

afterEach(() => { jest.clearAllMocks(); n = 0; });

test('week bounds are PKT Monday 00:00 to the next Monday (19:00Z the Sunday before)', () => {
  expect(Strip.weekBounds(WEEK)).toEqual({ start: '2026-10-11T19:00:00.000Z', end: '2026-10-18T19:00:00.000Z' });
  expect(Strip.isoWeekOf(Date.parse('2026-10-18T18:59:59Z'))).toBe('2026-W42');
  expect(Strip.isoWeekOf(Date.parse('2026-10-18T19:00:00Z'))).toBe('2026-W43');
});

test('lost readings = failed (swept included) ÷ attempted (scored + failed) per fixed band × language', async () => {
  install(checkRows());
  await Strip.weeklyStrip({ week: WEEK, now: NOW });
  expect(line('lost_readings', 'G23|ur')).toMatchObject({ value: 0.4, n: 5 });
  expect(line('lost_readings_swept', 'G23|ur')).toMatchObject({ value: 0.2, n: 5 });   // 1 swept of 5 attempted
});

test('plays by mode; % roster-bound; % helped per cell; provenance complete', async () => {
  install(checkRows());
  await Strip.weeklyStrip({ week: WEEK, now: NOW });
  expect(line('plays', 'check')).toMatchObject({ value: 3, n: 3 });
  expect(line('plays', 'legacy')).toMatchObject({ value: 1, n: 1 });
  expect(line('roster_bound_pct')).toMatchObject({ value: 1 / 3, n: 3 });
  expect(line('helped_pct', 'G23|ur|read')).toMatchObject({ value: 1 / 3, n: 3 });
  expect(line('provenance_incomplete')).toMatchObject({ value: 0, n: 5 });
});

test('a v2 row missing a provenance column is counted', async () => {
  install([...checkRows(), v2({ canonical_id: C, homonym_in_list: null })]);
  await Strip.weeklyStrip({ week: WEEK, now: NOW });
  expect(line('provenance_incomplete')).toMatchObject({ value: 1, n: 6 });
});

test('a practice row never enters any cell (every band/lang cell is the same with or without practice rows)', async () => {
  install(checkRows());
  await Strip.weeklyStrip({ week: WEEK, now: NOW });
  const cells = (rows) => rows.filter((r) => r.cell.includes('|') || ['roster_bound_pct', 'no_class_first_finishes'].includes(r.line))
    .map((r) => `${r.line}/${r.cell}=${r.value}/${r.n}`).sort();
  const without = cells(db.web_quiz_strip_weekly);
  n = 0;
  install([...checkRows(), ...practiceRows()]);
  await Strip.weeklyStrip({ week: WEEK, now: NOW });
  expect(cells(db.web_quiz_strip_weekly)).toEqual(without);
  expect(without.length).toBeGreaterThan(3);
  expect(line('plays', 'practice')).toMatchObject({ value: 2 });
});

test('B3: share of attempted counted reads from rung ≤ 1 children (no lamp yet counts as the bottom)', async () => {
  install(checkRows(), {
    child_rungs: [
      { canonical_id: A, ladder: 'reading', rung: 1, set_at: '2026-10-01T00:00:00Z' },
      { canonical_id: B, ladder: 'reading', rung: 3, set_at: '2026-10-01T00:00:00Z' },
      { canonical_id: B, ladder: 'reading', rung: 1, set_at: '2026-09-01T00:00:00Z' },
      { canonical_id: C, ladder: 'numbers', rung: 4, set_at: '2026-10-01T00:00:00Z' },
    ],
  });
  await Strip.weeklyStrip({ week: WEEK, now: NOW });
  // attempted reads: A×2 (rung 1), B×2 (rung 3), C×1 (no reading lamp) → bottom 3 of 5
  expect(line('b3_bottom_share', 'G23|ur')).toMatchObject({ value: 0.6, n: 5 });
});

test('kept audio: count(audio_key) = count(kept_ok) and the oldest kept age', async () => {
  const kept = (id, extra) => v2({ id, created_at: '2026-09-01T00:00:00Z', ...extra });
  install([
    kept('k1', { audio_consent: 'kept_ok', scored_at: '2026-09-19T06:00:00Z', audio_keep_until: '2026-12-18T06:00:00Z', meta: { audio_key: KEY('k1') } }),
    kept('k2', { audio_consent: 'kept_ok', scored_at: '2026-10-09T06:00:00Z', audio_keep_until: '2027-01-07T06:00:00Z', meta: { audio_key: KEY('k2') } }),
    kept('k3', { audio_consent: 'kept_no' }),
    kept('k4', { audio_consent: 'not_asked' }),
  ]);
  await Strip.weeklyStrip({ week: WEEK, now: NOW });
  expect(line('kept_audio_keys')).toMatchObject({ value: 2, n: 2 });
  expect(line('kept_audio_match')).toMatchObject({ value: 1 });
  expect(line('kept_audio_oldest_d')).toMatchObject({ value: 30 });
});

test('kept audio mismatch: a kept_ok row inside its window without its reading shows 0', async () => {
  install([
    v2({ id: 'k1', audio_consent: 'kept_ok', scored_at: '2026-10-09T06:00:00Z', audio_keep_until: '2027-01-07T06:00:00Z', meta: { audio_key: KEY('k1') } }),
    v2({ id: 'k2', audio_consent: 'kept_ok', scored_at: '2026-10-09T06:00:00Z', audio_keep_until: '2027-01-07T06:00:00Z', meta: {} }),
  ]);
  await Strip.weeklyStrip({ week: WEEK, now: NOW });
  expect(line('kept_audio_keys')).toMatchObject({ value: 1, n: 2 });
  expect(line('kept_audio_match')).toMatchObject({ value: 0 });
});

test('sends by trigger, bot-to-family and the door-mix numerator come from message_ledger', async () => {
  install([], {
    message_ledger: [
      { day: '2026-10-12', trigger: 'home_reply', class_id: null, initiated: 'user', recipient: 'family', count: 3, usd: 0.045 },
      { day: '2026-10-18', trigger: 'guest_reply', class_id: null, initiated: 'user', recipient: 'family', count: 1, usd: 0.015 },
      { day: '2026-10-14', trigger: 'class_round', class_id: CLS, initiated: 'bot', recipient: 'teacher', count: 2, usd: 0.03 },
      { day: '2026-10-19', trigger: 'home_reply', class_id: null, initiated: 'user', recipient: 'family', count: 9, usd: 0.135 },
    ],
  });
  await Strip.weeklyStrip({ week: WEEK, now: NOW });
  expect(line('sends', 'home_reply')).toMatchObject({ value: 3 });
  expect(line('sends', 'class_round')).toMatchObject({ value: 2 });
  expect(line('sends_total')).toMatchObject({ value: 6 });
  expect(Number(line('sends_usd').value.toFixed(3))).toBe(0.09);
  expect(line('bot_to_family')).toMatchObject({ value: 0 });
  expect(line('door_mix_numerator')).toMatchObject({ value: 4 });
});

test('the sends lines carry their caveat: the ledger counts the switched replies only and is not the bill', async () => {
  install([], { message_ledger: [{ day: '2026-10-12', trigger: 'home_reply', class_id: null, initiated: 'user', recipient: 'family', count: 3, usd: 0.045 }] });
  const out = await Strip.weeklyStrip({ week: WEEK, now: NOW });
  expect(out.notes).toEqual({ sends: Strip.LINE_NOTES.sends, recognised_without_typing: Strip.LINE_NOTES.recognised_without_typing, cold_clips: Strip.LINE_NOTES.cold_clips,
    cells_n30: Strip.PERIOD_NOTES['2026-10'], anchor_retest_gap: Strip.PERIOD_NOTES['2026-10'] });   // an October week: the short first period
  expect(Strip.LINE_NOTES.sends).toMatch(/switched replies only/);
  expect(Strip.LINE_NOTES.sends).toMatch(/not the bill/);
  expect(Strip.LINE_NOTES.sends).toMatch(/Meta's billable count is the cost total/);
});

test('anchor retest gap: (returners − first-timers) ÷ pooled SD over the MONTH to date, on the statement\'s gate only', async () => {
  const anc = (k, ok, extra = {}) => v2({ exercise: 'missing', anchor_block: 'A1', anchor_exposure_no: k, score: { correct: ok, n: 10, reached: 10 }, ...extra });
  install([
    anc(1, 10), anc(1, 12),
    anc(2, 14, { created_at: '2026-10-02T08:00:00Z' }),       // earlier this month, before the week: counts (month to date)
    anc(3, 16),
    // outside the gate: helped, low confidence, an unfinished block, practice, not scored, after the week, another month
    anc(1, 0, { helped: 'helped' }),
    anc(1, 0, { id_confidence: 'low' }),
    anc(1, 0, { score: { correct: 3, n: 3, reached: 3 } }),
    anc(2, 30, { mode: 'practice' }),
    anc(2, 30, { status: 'failed' }),
    anc(2, 30, { created_at: '2026-10-20T08:00:00Z' }),
    anc(2, 30, { period_id: '2026-09', created_at: '2026-09-30T08:00:00Z' }),
  ], { students: roster() });
  await Strip.weeklyStrip({ week: WEEK, now: NOW });
  // means 11 vs 15, each sd √2 → pooled √2 → gap 4/√2; the cell is band × language × ladder × block
  const l = line('anchor_retest_gap', 'G23|ur|numbers|A1');
  expect(l.value).toBeCloseTo(4 / Math.SQRT2, 6);
  expect(l.n).toBe(4);
});

test('the anchor month is the week\'s Monday\'s (a week that starts in one month and ends in the next reads the first)', async () => {
  const anc = (k, ok, at, period) => v2({ exercise: 'missing', anchor_block: 'A1', anchor_exposure_no: k, period_id: period, created_at: at, score: { correct: ok, n: 10, reached: 10 } });
  // 2026-W44: Mon 26 Oct – Sun 1 Nov (PKT)
  install([
    anc(1, 10, '2026-10-27T08:00:00Z', '2026-10'), anc(1, 12, '2026-10-27T08:00:00Z', '2026-10'),
    anc(2, 14, '2026-10-28T08:00:00Z', '2026-10'), anc(2, 16, '2026-10-28T08:00:00Z', '2026-10'),
    anc(1, 1, '2026-11-01T08:00:00Z', '2026-11'), anc(1, 2, '2026-11-01T08:00:00Z', '2026-11'),
    anc(2, 9, '2026-11-01T08:00:00Z', '2026-11'), anc(2, 9, '2026-11-01T08:00:00Z', '2026-11'),
  ], { students: roster() });
  await Strip.weeklyStrip({ week: '2026-W44', now: NOW });
  expect(line('anchor_retest_gap', 'G23|ur|numbers|A1')).toMatchObject({ n: 4 });
  expect(line('anchor_retest_gap', 'G23|ur|numbers|A1').value).toBeCloseTo(4 / Math.SQRT2, 6);
});

test('writing the same week twice is idempotent (one row per week × line × cell, same values)', async () => {
  install(checkRows());
  await Strip.weeklyStrip({ week: WEEK, now: NOW });
  const first = JSON.stringify(db.web_quiz_strip_weekly.map(({ computed_at, ...r }) => r));
  const count = db.web_quiz_strip_weekly.length;
  await Strip.weeklyStrip({ week: WEEK, now: NOW });
  expect(db.web_quiz_strip_weekly.length).toBe(count);
  expect(JSON.stringify(db.web_quiz_strip_weekly.map(({ computed_at, ...r }) => r))).toBe(first);
});

test('a malformed week is refused before any query', async () => {
  install([]);
  await expect(Strip.weeklyStrip({ week: '2026-42', now: NOW })).rejects.toThrow(/week/);
});

test('cells at n = 30 count CHILDREN (distinct canonical id), not rows: usable = self, high confidence, record, first exposure or an anchor row', async () => {
  install([
    // one child, two usable scored rows in the same cell (a passage first exposure and an anchor row) → 1 child
    v2({ canonical_id: A, exercise: 'bigger' }),
    v2({ canonical_id: A, exercise: 'bigger', exposure_no: 2, anchor_block: 'A1', anchor_exposure_no: 1 }),
    // other children whose rows are not usable: helped, low confidence, not the record, a later exposure
    v2({ canonical_id: B, exercise: 'bigger', helped: 'helped' }),
    v2({ canonical_id: C, exercise: 'bigger', id_confidence: 'low' }),
    v2({ canonical_id: C, exercise: 'bigger', record: false }),
    v2({ canonical_id: B, exercise: 'bigger', exposure_no: 2 }),
  ], { students: roster() });
  await Strip.weeklyStrip({ week: WEEK, now: NOW });
  expect(line('cells_n30', 'G23|ur|numbers')).toMatchObject({ value: 1, n: 1 });
});

describe('replies per bound child (D3): home_reply + bind_reply sends ÷ children with an active phone binding at the cut', () => {
  const END = '2026-10-18T19:00:00.000Z';                 // the week's cut
  const bind = (id, canonical_id, extra = {}) => ({
    id, canonical_id, phone_norm: '+92300FIXTURE1', phone_tomb: 'f'.repeat(32), via: 'save', confirmed_at: '2026-10-01T00:00:00Z',
    bound_at: '2026-10-01T00:00:00Z', expires_at: '2027-03-31T18:59:59Z', revoked_at: null, revoked_by: null, ...extra,
  });
  const ledger = () => [
    { day: '2026-10-12', trigger: 'home_reply', initiated: 'user', recipient: 'family', count: 3, usd: 0.045 },
    { day: '2026-10-16', trigger: 'bind_reply', initiated: 'user', recipient: 'family', count: 2, usd: 0.03 },
    { day: '2026-10-16', trigger: 'guest_reply', initiated: 'user', recipient: 'family', count: 4, usd: 0.06 },
    { day: '2026-10-19', trigger: 'home_reply', initiated: 'user', recipient: 'family', count: 7, usd: 0.105 },
  ];

  test('active at the cut = bound before it, not erased before it, not expired by it; a child counts once', async () => {
    install([], {
      message_ledger: ledger(),
      child_phone_bindings: [
        bind('b1', A), bind('b2', A, { phone_norm: '+92300FIXTURE2' }),                          // one child, two phones
        bind('b3', B, { phone_norm: null, revoked_at: '2026-10-15T00:00:00Z', revoked_by: 'stop' }),   // erased before the cut
        bind('b4', C, { bound_at: '2026-10-19T08:00:00Z' }),                                   // bound after the cut
        bind('b5', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', { expires_at: '2026-10-10T00:00:00Z' }),   // expired before the cut
        bind('b6', CLS, { phone_norm: null, revoked_at: '2026-10-19T03:00:00Z', revoked_by: 'page_undo' }),   // erased after the cut: active at it
      ],
    });
    await Strip.weeklyStrip({ week: WEEK, now: NOW });
    expect(line('replies_per_bound_child')).toMatchObject({ value: 2.5, n: 2 });   // (3 + 2) ÷ {A, CLS-child}
    expect(END).toBe(Strip.weekBounds(WEEK).end);
  });

  test('no bound child: the share is empty (null, n 0)', async () => {
    install([], { message_ledger: ledger(), child_phone_bindings: [] });
    await Strip.weeklyStrip({ week: WEEK, now: NOW });
    expect(line('replies_per_bound_child')).toMatchObject({ value: null, n: 0 });
  });

  test('child_phone_bindings not there yet: the line is skipped and the skip is logged; the send lines stay', async () => {
    const { logToFile } = require('../../../shared/utils/logger');
    install([], { message_ledger: ledger() });
    const realFrom = supabase.from;
    supabase.from = (t) => (t === 'child_phone_bindings'
      ? { select: () => { const q = { gte: () => q, lt: () => q, order: () => q, limit: async () => ({ data: null, error: { code: '42P01', message: 'relation "child_phone_bindings" does not exist' } }) }; return q; } }
      : realFrom(t));
    await Strip.weeklyStrip({ week: WEEK, now: NOW });
    expect(line('replies_per_bound_child')).toBeUndefined();
    expect(line('sends_total')).toMatchObject({ value: 9 });
    expect(logToFile).toHaveBeenCalledWith(expect.stringMatching(/skipped/), expect.objectContaining({ skipped: expect.arrayContaining(['replies_per_bound_child']) }));
  });

  test('message_ledger not there yet: no replies-per-child line either', async () => {
    install([], { child_phone_bindings: [bind('b1', A)] });
    const realFrom = supabase.from;
    supabase.from = (t) => (t === 'message_ledger'
      ? { select: () => { const q = { gte: () => q, lt: async () => ({ data: null, error: { code: '42P01', message: 'relation "message_ledger" does not exist' } }) }; return q; } }
      : realFrom(t));
    await Strip.weeklyStrip({ week: WEEK, now: NOW });
    expect(line('replies_per_bound_child')).toBeUndefined();
  });
});

describe('record duplicates and lamps settled without answers (counts only)', () => {
  const PREV = '2026-10-08T08:00:00Z';                     // 2026-W41
  const dup = (extra = {}) => v2({ mode: 'practice', record: false, meta: { record_lost: 'duplicate' }, ...extra });

  test('record_duplicates: the week\'s record_lost = duplicate rows over the attempts at a record (records + duplicates)', async () => {
    install([
      dup(), dup({ canonical_id: B, status: 'failed' }),
      v2({ canonical_id: A }), v2({ canonical_id: B }), v2({ canonical_id: C, status: 'failed' }),
      dup({ created_at: PREV }),                             // the week before: not counted
      v2({ canonical_id: C, created_at: PREV }),              // a record the week before: not counted
      v2({ canonical_id: C, mode: 'practice', record: false }),   // practice without record_lost: neither
    ]);
    await Strip.weeklyStrip({ week: WEEK, now: NOW });
    expect(line('record_duplicates')).toMatchObject({ value: 2, n: 5 });
  });

  test('lamps_settled_unanswered: the week\'s lamps_settled_day rows summed; n = scored record readings of the week', async () => {
    install([
      v2({ canonical_id: A }), v2({ canonical_id: B }),
      v2({ canonical_id: C, mode: 'practice', record: false }),       // a practice read: excluded
      v2({ canonical_id: C, status: 'failed' }),                       // a failed read: excluded
      v2({ canonical_id: C, exercise: 'bigger' }),                     // not a reading: excluded
      v2({ canonical_id: C, created_at: PREV }),                       // the week before: excluded
    ], {
      web_quiz_strip_weekly: [
        { week: WEEK, line: 'lamps_settled_day', cell: '2026-10-13', value: 1, n: 4 },
        { week: WEEK, line: 'lamps_settled_day', cell: '2026-10-15', value: 2, n: 5 },
        { week: '2026-W41', line: 'lamps_settled_day', cell: '2026-10-08', value: 7, n: 9 },
      ],
    });
    await Strip.weeklyStrip({ week: WEEK, now: NOW });
    expect(line('lamps_settled_unanswered')).toMatchObject({ value: 3, n: 2 });
  });

  test('lamps_settled_unanswered with no daily rows (rung switch off all week): value 0, n as usual', async () => {
    install([v2({ canonical_id: A })]);
    await Strip.weeklyStrip({ week: WEEK, now: NOW });
    expect(line('lamps_settled_unanswered')).toMatchObject({ value: 0, n: 1 });
    expect(line('record_duplicates')).toMatchObject({ value: 0, n: 1 });
  });

  test('settledSnapshot writes one lamps_settled_day row in the day\'s week (value = settled, n = checked)', async () => {
    install([]);
    await Strip.settledSnapshot({ day: '2026-10-15', settled: 1, checked: 4, now: NOW });
    expect(db.web_quiz_strip_weekly.filter((r) => r.line === 'lamps_settled_day')).toEqual([
      expect.objectContaining({ week: WEEK, line: 'lamps_settled_day', cell: '2026-10-15', value: 1, n: 4 }),
    ]);
  });
});
