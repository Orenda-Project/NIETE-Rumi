'use strict';
/**
 * The class round's term sampler: ~40 classes a term, stratified by sector × grade band, from classes with an
 * active roster; a seeded generator for tests; never a class twice in a term; one draw row and one
 * class_round_drawn event per class; runs only with web_quiz_class_round on (and its parents). The teacher's
 * invitation is NOT sent (no copy key exists for it): nothing goes to WhatsApp and nothing to the ledger.
 * Faked: Supabase (in-memory, filters applied), the event logger, the hashed-key module (virtual), WhatsApp.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(), sendTextMessage: jest.fn(), sendInteractiveMessage: jest.fn() }));
jest.mock('../../../shared/services/quiz/web-quiz-kid', () => ({
  kid: (id) => `kid(${id})`, cls: (id) => `cls(${String(id).slice(-4)})`, envelope: (f) => ({ w: 's', ev_v: 2, kid_v: '2026', ...f }),
}));
jest.mock('../../../shared/services/quiz/message-ledger', () => ({ record: jest.fn() }));

const { makeFake } = require('./fake-supabase');
const { strictFrom } = require('./class-round-strict-fake');

const ON = [
  { key: 'web_quiz_challenge', value: true }, { key: 'web_quiz_challenge_v2', value: true }, { key: 'web_quiz_class_round', value: true },
  { key: 'web_quiz_hub', value: true }, { key: 'web_quiz_events_v2', value: true },
];
const NOW = Date.parse('2026-10-15T06:00:00Z');
// the round's window (term 2026-27b), and one in term 2027-28a
const WIN_B = { start: '2027-01-18T00:00:00+05:00', end: '2027-02-15T00:00:00+05:00' };
const WIN_A = { start: '2027-05-03T00:00:00+05:00', end: '2027-05-31T00:00:00+05:00' };
const seeded = (s) => () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
// the signed analysis plan's sha256 (the draw stores it on every row)
const PLAN = 'c971d4d956f5b0f1e0cc297b04696b20e1985a0a4b7161ddbefac40e4079c2bb';
const uuid = (p, n) => `${p}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// 4 sectors × 2 grade bands, uneven: 120 eligible classes; plus classes that must never be drawn.
let DB;
function seed(settings = ON) {
  const schools = [];
  const classes = [];
  const enr = [];
  let c = 0;
  const sectors = ['Sector A', 'Sector B', 'Sector C', 'Sector D'];
  const sizes = { 'Sector A': [30, 10], 'Sector B': [20, 20], 'Sector C': [15, 5], 'Sector D': [10, 10] };
  sectors.forEach((sec, si) => {
    const school = uuid('d', si + 1);
    schools.push({ id: school, name: `School ${si}`, region: sec, is_active: true, is_probable_test: false });
    [['grade_2', 0], ['grade_5', 1]].forEach(([g, bi]) => {
      for (let i = 0; i < sizes[sec][bi]; i += 1) {
        c += 1;
        const id = uuid('c', c);
        classes.push({ id, school_id: school, grade_code: g, section: 'A', is_active: true });
        for (let k = 0; k < 8; k += 1) enr.push({ id: `e${c}-${k}`, class_id: id, student_id: uuid('b', c * 100 + k), is_active: true });
      }
    });
  });
  // never drawn: grade 1, grade 7, an empty roster, a tiny roster, an inactive class, a test school
  const testSchool = uuid('d', 99);
  schools.push({ id: testSchool, name: 'Probe', region: 'Sector A', is_active: true, is_probable_test: true });
  const bad = [
    { id: uuid('f', 1), school_id: schools[0].id, grade_code: 'grade_1', is_active: true, k: 8 },
    { id: uuid('f', 2), school_id: schools[0].id, grade_code: 'grade_7', is_active: true, k: 8 },
    { id: uuid('f', 3), school_id: schools[0].id, grade_code: 'grade_3', is_active: true, k: 0 },
    { id: uuid('f', 4), school_id: schools[0].id, grade_code: 'grade_3', is_active: true, k: 2 },
    { id: uuid('f', 5), school_id: schools[0].id, grade_code: 'grade_3', is_active: false, k: 8 },
    { id: uuid('f', 6), school_id: testSchool, grade_code: 'grade_3', is_active: true, k: 8 },
  ];
  bad.forEach((b) => {
    classes.push({ id: b.id, school_id: b.school_id, grade_code: b.grade_code, section: 'A', is_active: b.is_active });
    for (let k = 0; k < b.k; k += 1) enr.push({ id: `${b.id}-${k}`, class_id: b.id, student_id: uuid('a', k), is_active: true });
  });
  DB = { app_settings: settings.map((s) => ({ ...s })), schools, classes, class_enrollments: enr, class_round_draws: [] };
  const fake = makeFake(DB);
  Object.assign(require('../../../shared/config/supabase'), { from: strictFrom(fake), rpc: fake.rpc });
  return { bad: bad.map((b) => b.id) };
}

let Sampler; let logEvent;
beforeEach(() => {
  jest.resetModules();
  Sampler = require('../../../shared/services/quiz/web-quiz-class-round-sampler');
  ({ logEvent } = require('../../../shared/utils/structured-logger'));
});

test('the term code: Apr–Sep is a, Oct–Mar is b, in Pakistan time', () => {
  expect(Sampler.termCode(Date.parse('2026-10-15T06:00:00Z'))).toBe('2026-27b');
  expect(Sampler.termCode(Date.parse('2027-02-01T00:00:00Z'))).toBe('2026-27b');
  expect(Sampler.termCode(Date.parse('2027-03-31T19:30:00Z'))).toBe('2027-28a'); // 1 April 00:30 PKT
  expect(Sampler.termCode(Date.parse('2026-09-30T18:59:00Z'))).toBe('2026-27a');
});

test('pure draw: 40 by default, proportional per stratum, seeded and repeatable', () => {
  const cands = [];
  [['S1|G23', 60], ['S1|G45', 20], ['S2|G23', 20]].forEach(([st, n]) => { for (let i = 0; i < n; i += 1) cands.push({ class_id: `${st}-${i}`, stratum: st, roster_k: 10 }); });
  const a = Sampler.drawClasses(cands, { rng: seeded(1) });
  expect(Sampler.DRAW_K).toBe(40);
  expect(a).toHaveLength(40);
  const per = (xs) => xs.reduce((m, x) => ({ ...m, [x.stratum]: (m[x.stratum] || 0) + 1 }), {});
  expect(per(a)).toEqual({ 'S1|G23': 24, 'S1|G45': 8, 'S2|G23': 8 });
  expect(new Set(a.map((x) => x.class_id)).size).toBe(40);
  expect(Sampler.drawClasses(cands, { rng: seeded(1) })).toEqual(a);
  expect(Sampler.drawClasses(cands, { rng: seeded(2) }).map((x) => x.class_id)).not.toEqual(a.map((x) => x.class_id));
});

test('the job: 40 draws stratified by sector × grade band, only eligible classes, rows + class_round_drawn exactly; no send', async () => {
  const { bad } = seed();
  const out = await Sampler.runTermDraw({ planSha256: PLAN, now: NOW, rng: seeded(7), window: WIN_B });
  expect(out.drawn).toBe(40);
  const rows = DB.class_round_draws;
  expect(rows).toHaveLength(40);
  rows.forEach((r) => {
    expect(r.term_code).toBe('2026-27b');
    expect(r.round).toMatch(/^[0-9a-f]{16}$/);
    expect(r.roster_k).toBe(8);
    expect(r.stratum).toMatch(/^Sector [ABCD]\|G(23|45)$/);
    expect(bad).not.toContain(r.class_id);
    expect(r.state).toBeNull();
  });
  expect(new Set(rows.map((r) => r.round)).size).toBe(40);
  const per = rows.reduce((m, r) => ({ ...m, [r.stratum]: (m[r.stratum] || 0) + 1 }), {});
  // 120 eligible: A 30/10, B 20/20, C 15/5, D 10/10 → 40 × share
  expect(per).toEqual({ 'Sector A|G23': 10, 'Sector A|G45': 3, 'Sector B|G23': 7, 'Sector B|G45': 7, 'Sector C|G23': 5, 'Sector C|G45': 2, 'Sector D|G23': 3, 'Sector D|G45': 3 });
  const ev = logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.class_round_drawn').map((c) => c[1]);
  expect(ev).toHaveLength(40);
  ev.forEach((e) => expect(Object.keys(e).sort()).toEqual(['cls', 'ev_v', 'roster_k', 'round', 'stratum', 'term', 'w']));
  expect(JSON.stringify(ev)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  const WA = require('../../../shared/services/whatsapp.service');
  Object.values(WA).forEach((fn) => expect(fn).not.toHaveBeenCalled());
  expect(require('../../../shared/services/quiz/message-ledger').record).not.toHaveBeenCalled();
});

test('never a class twice in a term: a second run adds nothing; the next term may draw again', async () => {
  seed();
  await Sampler.runTermDraw({ planSha256: PLAN, now: NOW, rng: seeded(7), window: WIN_B });
  const again = await Sampler.runTermDraw({ planSha256: PLAN, now: NOW + 86400000, rng: seeded(8), window: WIN_B });
  expect(again.drawn).toBe(0);
  expect(DB.class_round_draws).toHaveLength(40);
  const ids = DB.class_round_draws.map((r) => r.class_id);
  expect(new Set(ids).size).toBe(ids.length);
  const next = await Sampler.runTermDraw({ planSha256: PLAN, now: Date.parse('2027-04-01T20:00:00Z'), rng: seeded(9), window: WIN_A });
  expect(next.drawn).toBe(40);
  expect(DB.class_round_draws.filter((r) => r.term_code === '2027-28a')).toHaveLength(40);
});

test('switch off (or a parent off): the job draws nothing and writes nothing', async () => {
  for (const settings of [ON.filter((s) => s.key !== 'web_quiz_class_round'), ON.filter((s) => s.key !== 'web_quiz_challenge_v2'), []]) {
    jest.resetModules();
    Sampler = require('../../../shared/services/quiz/web-quiz-class-round-sampler');
    seed(settings);
    const out = await Sampler.runTermDraw({ planSha256: PLAN, now: NOW, rng: seeded(7), window: WIN_B });
    expect(out).toEqual({ drawn: 0, skipped: 'off' });
    expect(DB.class_round_draws).toEqual([]);
  }
});

describe('the draw object (windows, strata, no replacement draws)', () => {
  const WIN = { start: '2027-01-18T00:00:00+05:00', end: '2027-02-15T00:00:00+05:00' };
  test('every row carries the stratum sizes, p_incl, the seed, the windows ≥ 21 days apart, k_counted 10 and an order arm; same seed, same draw', async () => {
    seed();
    const out = await Sampler.runTermDraw({ planSha256: PLAN, now: NOW, seed: 4242, window: WIN });
    expect(out.drawn).toBe(40);
    const rows = DB.class_round_draws;
    const N = { 'Sector A|G23': 30, 'Sector A|G45': 10, 'Sector B|G23': 20, 'Sector B|G45': 20, 'Sector C|G23': 15, 'Sector C|G45': 5, 'Sector D|G23': 10, 'Sector D|G45': 10 };
    const n = rows.reduce((m, r) => ({ ...m, [r.stratum]: (m[r.stratum] || 0) + 1 }), {});
    rows.forEach((r) => {
      expect(r.N_h).toBe(N[r.stratum]);
      expect(r.n_h).toBe(n[r.stratum]);
      expect(r.p_incl).toBeCloseTo(n[r.stratum] / N[r.stratum], 6);
      expect(r.seed).toBe(4242);
      expect(r.weights_version).toBe('cr-2026-27b.1');
      expect(r.plan_sha256).toBe(PLAN);
      expect(r.k_counted).toBe(10);
      expect(Date.parse(r.window_start)).toBe(Date.parse(WIN.start));
      expect(Date.parse(r.window_end)).toBe(Date.parse(WIN.end));
      expect(['round_first', 'week_first']).toContain(r.order_arm);
      const ws = Date.parse(r.week_start); const we = Date.parse(r.week_end);
      if (r.order_arm === 'round_first') expect(ws - Date.parse(r.window_end)).toBeGreaterThanOrEqual(21 * 86400000);
      else expect(Date.parse(r.window_start) - we).toBeGreaterThanOrEqual(21 * 86400000);
      expect(r.accepted_at).toBeNull();
      expect(r.declined_at).toBeNull();
    });
    expect(new Set(rows.map((r) => r.order_arm)).size).toBe(2);
    const first = rows.map((r) => [r.class_id, r.order_arm]);
    seed();
    await Sampler.runTermDraw({ planSha256: PLAN, now: NOW, seed: 4242, window: WIN });
    expect(DB.class_round_draws.map((r) => [r.class_id, r.order_arm])).toEqual(first);
  });

  test('no replacement draws: once a term has a draw, a second run adds nothing, even after a class declines', async () => {
    seed();
    await Sampler.runTermDraw({ planSha256: PLAN, now: NOW, seed: 1, window: WIN });
    DB.class_round_draws[0].declined_at = new Date(NOW).toISOString();
    DB.class_round_draws.splice(1, 1);
    const again = await Sampler.runTermDraw({ planSha256: PLAN, now: NOW + 86400000, seed: 2, window: WIN });
    expect(again).toEqual({ drawn: 0, skipped: 'already_drawn' });
    expect(DB.class_round_draws).toHaveLength(39);
  });

  test('a window across 1 April, outside the term, or in the term\'s last two weeks is refused: nothing drawn', async () => {
    for (const w of [
      { start: '2027-03-25T00:00:00+05:00', end: '2027-04-08T00:00:00+05:00' },
      { start: '2027-03-18T00:00:00+05:00', end: '2027-03-30T00:00:00+05:00' },
      { start: '2026-09-01T00:00:00+05:00', end: '2026-09-20T00:00:00+05:00' },
      null,
    ]) {
      seed();
      const out = await Sampler.runTermDraw({ planSha256: PLAN, now: NOW, seed: 1, window: w });
      expect(out).toEqual({ drawn: 0, skipped: 'bad_window' });
      expect(DB.class_round_draws).toEqual([]);
    }
  });

  test('the invitation stays a stub: template jugnu_round_invite_<lang>, the category rate as usd_each, trigger class_round; nothing sent', async () => {
    const d = { class_id: uuid('c', 1), round: '0123456789abcdef' };
    const { UX_STRINGS } = require('../../../shared/config/ux-strings');
    expect(await Sampler.inviteTeacher(d, { lang: 'ur', category: 'marketing' })).toEqual({ sent: false, reason: 'stub', template: 'jugnu_round_invite_ur', body: UX_STRINGS.roundInvite.ur, trigger: 'class_round', usd_each: 0.0473 });
    expect(await Sampler.inviteTeacher(d)).toEqual({ sent: false, reason: 'stub', template: 'jugnu_round_invite_en', body: UX_STRINGS.roundInvite.en, trigger: 'class_round', usd_each: 0.015 });
    const WA = require('../../../shared/services/whatsapp.service');
    Object.values(WA).forEach((fn) => expect(fn).not.toHaveBeenCalled());
    expect(require('../../../shared/services/quiz/message-ledger').record).not.toHaveBeenCalled();
  });
});

describe('the draw names its plan, keeps a class to once an academic year, and is never late', () => {
  const WIN = { start: '2027-01-18T00:00:00+05:00', end: '2027-02-15T00:00:00+05:00' };
  test('refused without the signed plan\'s sha256 (64 lower-case hex): nothing drawn', async () => {
    for (const planSha256 of [undefined, null, '', PLAN.toUpperCase(), PLAN.slice(1), `${PLAN}0`, 'g'.repeat(64)]) {
      seed();
      const out = await Sampler.runTermDraw({ now: NOW, seed: 5, window: WIN, planSha256 });
      expect(out).toEqual({ drawn: 0, skipped: 'no_plan' });
      expect(DB.class_round_draws).toEqual([]);
    }
  });

  test('every row stores the plan\'s sha256, the plan\'s weights version and the seed, even when a test generator is injected', async () => {
    seed();
    await Sampler.runTermDraw({ planSha256: PLAN, now: NOW, rng: seeded(3), window: WIN });
    expect(DB.class_round_draws).toHaveLength(40);
    DB.class_round_draws.forEach((r) => {
      expect(r.plan_sha256).toBe(PLAN);
      expect(r.weights_version).toBe('cr-2026-27b.1');
      expect(Number.isSafeInteger(r.seed)).toBe(true);
    });
    expect(new Set(DB.class_round_draws.map((r) => r.seed)).size).toBe(1);
  });

  test('a class drawn in 2027-28a is not in the frame for 2027-28b; 2028-29a may draw it again', async () => {
    seed();
    const a = await Sampler.runTermDraw({ planSha256: PLAN, now: Date.parse('2027-04-01T20:00:00Z'), seed: 9, window: { start: '2027-05-03T00:00:00+05:00', end: '2027-05-31T00:00:00+05:00' } });
    expect(a.drawn).toBe(40);
    const drawnA = new Set(DB.class_round_draws.map((r) => r.class_id));
    const b = await Sampler.runTermDraw({ planSha256: PLAN, now: Date.parse('2027-10-05T06:00:00Z'), seed: 9, window: { start: '2028-01-17T00:00:00+05:00', end: '2028-02-14T00:00:00+05:00' } });
    expect(b.drawn).toBe(40);
    const rowsB = DB.class_round_draws.filter((r) => r.term_code === '2027-28b');
    expect(rowsB).toHaveLength(40);
    rowsB.forEach((r) => expect(drawnA.has(r.class_id)).toBe(false));
    // N_h counts the year's frame: the classes drawn in 2027-28a are out of it
    expect(rowsB.reduce((m, r) => ({ ...m, [r.stratum]: r.N_h }), {})).toEqual({ 'Sector A|G23': 20, 'Sector A|G45': 7, 'Sector B|G23': 13, 'Sector B|G45': 13, 'Sector C|G23': 10, 'Sector C|G45': 3, 'Sector D|G23': 7, 'Sector D|G45': 7 });
    const c = await Sampler.runTermDraw({ planSha256: PLAN, now: Date.parse('2028-04-01T20:00:00Z'), seed: 9, window: { start: '2028-05-01T00:00:00+05:00', end: '2028-05-29T00:00:00+05:00' } });
    expect(c.drawn).toBe(40);
  });

  test('late: a draw whose round window has opened is refused, nothing written', async () => {
    seed();
    const out = await Sampler.runTermDraw({ planSha256: PLAN, now: Date.parse('2027-01-20T06:00:00Z'), seed: 5, window: WIN });
    expect(out).toEqual({ drawn: 0, skipped: 'window_open' });
    expect(DB.class_round_draws).toEqual([]);
  });

  test('late: a draw whose earliest class week (placed before the round) has opened is refused, nothing written', async () => {
    seed();
    // the round window opens in 10 days; a week_first class week would have opened 18 days ago
    const now = Date.parse(WIN.start) - 10 * 86400000;
    const out = await Sampler.runTermDraw({ planSha256: PLAN, now, rng: () => 0.9, window: WIN });
    expect(out).toEqual({ drawn: 0, skipped: 'window_open' });
    expect(DB.class_round_draws).toEqual([]);
  });

  test('the frame reads the draw table through its own columns only (a misspelt column would fail here)', async () => {
    seed();
    const { DRAW_COLS } = require('./class-round-strict-fake');
    ['plan_sha256', 'seed', 'weights_version', 'counted_k', 'present_counted_k', 'position_aggregates', 'week_forwarded_at'].forEach((c) => expect(DRAW_COLS.has(c)).toBe(true));
    await Sampler.runTermDraw({ planSha256: PLAN, now: NOW, seed: 5, window: WIN });
    expect(DB.class_round_draws).toHaveLength(40);
  });
});
