/**
 * bd-r2uzg1.18.1 — I-SAPS (Teacher Development Programme, Grades 9-12) is for teachers who teach HIGH.
 *
 * THE BUG. Band selection maps MIDDLE and HIGH to one programme, niete_middle_high
 * (band-selection.service.js bandsToPrograms), and that programme's scope lists the I-SAPS vendor with no level
 * filter. So a teacher who teaches Middle only (Grades 6-8) was shown, and could start, the Grades 9-12 course: on
 * WhatsApp (the training Flow's catalogue), on the portal's training pages, and at the exam gate.
 *
 * THE RULE (one place: bot/shared/services/training/vendor-band-gate.rules.js):
 *   - I-SAPS reached through a BAND programme counts only when her teacher_level includes HIGH;
 *   - a teacher without HIGH who already has I-SAPS work (a finished unit, an attempt, a certificate) keeps it —
 *     earned work is never taken away;
 *   - a programme assigned by hand (the I-SAPS pilot) is an explicit choice and is not gated;
 *   - nothing else changes for a Middle teacher (NIETE, Beacon House, Oxbridge).
 * Adding HIGH later needs no data change: the gate reads teacher_level on every load.
 *
 * Made-up data only (public repo).
 */

// Not a suite about the sign-in account check: every session user reads as live (tests/fixtures/portal-auth-live.js).
require('../fixtures/portal-auth-live').installLivePortalAccounts();

let supabaseFrom;
let tableStates;

/** A query chain that honours .eq/.in on every read (single-row reads included), and answers [] for unseeded tables. */
function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const filters = [];
  const run = () => {
    let rows = state.rows || [];
    for (const [col, val] of filters) {
      if (val && typeof val === 'object' && Array.isArray(val.in)) rows = rows.filter(r => val.in.includes(r[col]));
      else rows = rows.filter(r => r[col] === val);
    }
    return rows;
  };
  const chain = {};
  chain.select = () => chain;
  chain.eq = (col, val) => { filters.push([col, val]); return chain; };
  chain.in = (col, vals) => { filters.push([col, { in: vals }]); return chain; };
  ['neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'not', 'or', 'order', 'limit', 'range', 'filter', 'contains']
    .forEach(m => { chain[m] = () => chain; });
  chain.maybeSingle = async () => (state.error ? { data: null, error: state.error } : { data: run()[0] || null, error: null });
  chain.single = chain.maybeSingle;
  chain.then = (resolve, reject) =>
    Promise.resolve(state.error ? { data: null, error: state.error } : { data: run(), error: null }).then(resolve, reject);
  return chain;
}

const T = 'teacher-1';

/** NIETE (chain, levels 3-4), I-SAPS (levels 27, 31), Beacon House (40), Oxbridge (50); the prod programme shapes. */
function seed({ teacherLevel, programs = ['p-mh'], work = {} } = {}) {
  tableStates.users = { rows: [{ id: T, role: 'teacher', teacher_level: teacherLevel }] };
  tableStates.training_programs = { rows: [
    { id: 'p-prim', key: 'niete_primary' },
    { id: 'p-mh', key: 'niete_middle_high' },
    { id: 'p-pilot', key: 'niete_isaps_pilot' },
  ] };
  tableStates.training_vendors = { rows: [
    { id: 'v-niete', key: 'TALEEMABAD', name: 'NIETE', unlock_logic: 'chain', is_active: true },
    { id: 'v-isaps', key: 'ISAPS', name: 'Teacher Development Programme, 9-12', unlock_logic: 'all_modules', is_active: true },
    { id: 'v-bh', key: 'BEACONHOUSE', name: 'Subject Pedagogy', unlock_logic: 'all_modules', is_active: true },
    { id: 'v-ox', key: 'OXBRIDGE', name: 'Game-Based Teaching', unlock_logic: 'all_modules', is_active: true },
  ] };
  tableStates.training_program_scopes = { rows: [
    { program_id: 'p-prim', vendor_id: 'v-niete', level_ids: null },
    { program_id: 'p-mh', vendor_id: 'v-niete', level_ids: [3, 4] },
    { program_id: 'p-mh', vendor_id: 'v-isaps', level_ids: null },
    { program_id: 'p-mh', vendor_id: 'v-bh', level_ids: null },
    { program_id: 'p-mh', vendor_id: 'v-ox', level_ids: null },
    { program_id: 'p-pilot', vendor_id: 'v-isaps', level_ids: null },
  ] };
  tableStates.teacher_training_assignments = {
    rows: programs.map(program_id => ({ user_id: T, program_id, is_active: true })),
  };
  const levels = [[3, 'v-niete', 0], [4, 'v-niete', 1], [27, 'v-isaps', 0], [31, 'v-isaps', 1], [40, 'v-bh', 0], [50, 'v-ox', 0]];
  tableStates.training_levels = { rows: levels.map(([id, vendor_id, order_index]) => ({
    id, vendor_id, order_index, name: `Level ${id}`, cpd_level: null, is_active: true,
    training_vendors: { key: tableStates.training_vendors.rows.find(v => v.id === vendor_id).key, unlock_logic: 'all_modules' },
  })) };
  // two units per level, so one finished unit never completes (or certifies) a level
  tableStates.training_courses = { rows: levels.map(([id]) => ({ id: id * 10, level_id: id, is_active: true, title: `Module ${id}` })) };
  tableStates.training_modules = { rows: levels.flatMap(([id]) => [
    { id: id * 100, course_id: id * 10, is_active: true, title: `Unit ${id}a`, order_index: 1 },
    { id: id * 100 + 1, course_id: id * 10, is_active: true, title: `Unit ${id}b`, order_index: 2 },
  ]) };
  tableStates.teacher_training_progress = { rows: work.progress ? [{ user_id: T, module_id: 2700, completed_at: '2026-11-01T00:00:00Z' }] : [] };
  tableStates.training_assessment_attempts = { rows: work.attempt
    ? [{ user_id: T, level_id: 27, training_module_id: 2700, quiz_kind: 'training_module', status: 'completed', is_passed: false }]
    : [] };
  tableStates.training_certificates = { rows: work.certificate ? [{ user_id: T, level_id: 27, certificate_code: 'NIETE-TEST-0001' }] : [] };
  tableStates.training_grand_quizzes = { rows: [] };
}

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) return layer.route.stack.map(s => s.handle);
  }
  throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
}

async function invoke(method, path) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, method, path);
  const req = {
    session: { portalUserId: T, id: 'sess-1' }, params: {}, query: {}, body: {},
    method: method.toUpperCase(), path, ip: '127.0.0.1', headers: {}, get: () => undefined,
  };
  let statusCode = 200;
  let payload = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(body) { payload = body; return this; },
    set() { return this; },
  };
  for (const handler of stack) {
    let next = false;
    // eslint-disable-next-line no-await-in-loop
    await handler(req, res, () => { next = true; });
    if (!next) break;
  }
  return { statusCode, payload };
}

const vendorsOf = async () => (await invoke('get', '/training/vendors')).payload.vendors.map(v => v.vendor_key).sort();
const levelIdsOf = async () => (await invoke('get', '/training/levels')).payload.levels.map(l => l.id).sort((a, b) => a - b);
const bot = () => require('../../bot/shared/routes/teacher-training-endpoint');
const catalogVendors = async () => [...new Set((await bot().loadVisibleLevelsWithProgress(T)).map(l => l.vendor_key))].sort();

beforeEach(() => {
  jest.resetModules();
  tableStates = {};
  supabaseFrom = jest.fn(tbl => makeChain(tbl));
  jest.doMock('../../dashboard/config/supabase', () => ({ from: supabaseFrom, rpc: jest.fn().mockResolvedValue({ error: null }) }));
  // no real pg pool: its idle connections keep jest from exiting
  jest.doMock('../../dashboard/config/database', () => ({ query: jest.fn().mockResolvedValue({ rows: [] }), getPoolStats: () => ({}) }));
  const { installTrainingDelegation } = require('../fixtures/delegate-training-to-bot');
  installTrainingDelegation(() => supabaseFrom);
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn().mockResolvedValue(null),
    generatePresignedUrls: jest.fn().mockResolvedValue([]),
    isValidR2Url: jest.fn().mockReturnValue(true),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
});

afterEach(() => jest.resetModules());

const NOT_ISAPS = ['BEACONHOUSE', 'OXBRIDGE', 'TALEEMABAD'];
const WITH_ISAPS = ['BEACONHOUSE', 'ISAPS', 'OXBRIDGE', 'TALEEMABAD'];

describe('bd-r2uzg1.18.1 — a Middle-only teacher is not shown I-SAPS', () => {
  it('portal: GET /training/vendors lists NIETE, Beacon House and Oxbridge, not I-SAPS', async () => {
    seed({ teacherLevel: ['MIDDLE'] });
    expect(await vendorsOf()).toEqual(NOT_ISAPS);
  });

  it('portal: GET /training/levels has her NIETE, Beacon House and Oxbridge levels, no I-SAPS level', async () => {
    seed({ teacherLevel: ['MIDDLE'] });
    expect(await levelIdsOf()).toEqual([3, 4, 40, 50]);
  });

  it('WhatsApp: the training Flow catalogue has no I-SAPS level', async () => {
    seed({ teacherLevel: ['MIDDLE'] });
    expect(await catalogVendors()).toEqual(NOT_ISAPS);
  });

  it('exam unlock and opening a level refuse an I-SAPS level as not hers (deep links included)', async () => {
    seed({ teacherLevel: ['MIDDLE'] });
    expect((await bot().assertCanStartExamForLevel(T, 27)).reason).toBe('not_in_program');
    expect(await bot().checkLevelUnlocked(T, 27)).toMatchObject({ ok: false, status: 404 });
    // her own levels still open
    expect((await bot().checkLevelUnlocked(T, 40)).ok).toBe(true);
  });

  it('Primary + Middle (no High) is gated the same way', async () => {
    seed({ teacherLevel: ['PRIMARY', 'MIDDLE'], programs: ['p-prim', 'p-mh'] });
    expect(await vendorsOf()).toEqual(NOT_ISAPS);
  });

  it('an unknown teacher_level is not HIGH (no fallback; she gets I-SAPS by choosing High)', async () => {
    seed({ teacherLevel: null });
    expect(await vendorsOf()).toEqual(NOT_ISAPS);
  });
});

describe('bd-tsa15l — High only sees the Teacher Development Programme only (Hashir, 27 Nov)', () => {
  it('portal and WhatsApp: I-SAPS only; Primary + High: NIETE and I-SAPS, no Beacon House or Oxbridge', async () => {
    seed({ teacherLevel: ['HIGH'] });
    expect(await vendorsOf()).toEqual(['ISAPS']);
    expect(await catalogVendors()).toEqual(['ISAPS']);
    expect(await levelIdsOf()).toEqual([27, 31]);
    seed({ teacherLevel: ['PRIMARY', 'HIGH'], programs: ['p-prim', 'p-mh'] });
    expect(await vendorsOf()).toEqual(['ISAPS', 'TALEEMABAD']);
  });

  it('a teacher with no band keeps what her programmes give her (principals and coaches)', async () => {
    seed({ teacherLevel: null, programs: ['p-prim'] });
    expect(await vendorsOf()).toEqual(['TALEEMABAD']);
  });

  it('the seven combinations of Hashir\'s list', () => {
    const { requirementsFor } = require('../../bot/shared/services/training/vendor-band-gate.rules');
    const r = (b) => { const x = requirementsFor(b); return [x.niete.join(''), x.gbtla, x.aiPowered, x.tdp]; };
    expect(r(['PRIMARY'])).toEqual(['0123', false, false, false]);
    expect(r(['PRIMARY', 'MIDDLE'])).toEqual(['0123', true, true, false]);
    expect(r(['PRIMARY', 'MIDDLE', 'HIGH'])).toEqual(['0123', true, true, true]);
    expect(r(['PRIMARY', 'HIGH'])).toEqual(['0123', false, false, true]);
    expect(r(['MIDDLE', 'HIGH'])).toEqual(['23', true, true, true]);
    expect(r(['MIDDLE'])).toEqual(['23', true, true, false]);
    expect(r(['HIGH'])).toEqual(['', false, false, true]);
  });
});

describe('bd-r2uzg1.18.1 — who keeps I-SAPS', () => {
  it.each([
    ['Middle + High', ['MIDDLE', 'HIGH']],
    ['High stored lower-case', ['middle', 'high']],
  ])('%s: I-SAPS is shown on the portal and on WhatsApp', async (_label, level) => {
    seed({ teacherLevel: level });
    expect(await vendorsOf()).toEqual(WITH_ISAPS);
    expect(await catalogVendors()).toEqual(WITH_ISAPS);
    expect(await levelIdsOf()).toEqual([3, 4, 27, 31, 40, 50]);
  });

  it.each([
    ['a finished I-SAPS unit', { progress: true }],
    ['an I-SAPS attempt only', { attempt: true }],
    ['an I-SAPS certificate', { certificate: true }],
  ])('Middle-only with %s keeps I-SAPS (earned work is never taken away)', async (_label, work) => {
    seed({ teacherLevel: ['MIDDLE'], work });
    expect(await vendorsOf()).toEqual(WITH_ISAPS);
    expect(await catalogVendors()).toEqual(WITH_ISAPS);
    expect((await bot().checkLevelUnlocked(T, 27)).ok).toBe(true);
  });

  it('a hand-assigned I-SAPS programme (the pilot) is not gated, whatever her band', async () => {
    seed({ teacherLevel: ['PRIMARY'], programs: ['p-prim', 'p-pilot'] });
    expect(await vendorsOf()).toEqual(['ISAPS', 'TALEEMABAD']);
    seed({ teacherLevel: ['MIDDLE'], programs: ['p-mh', 'p-pilot'] });
    expect(await vendorsOf()).toEqual(WITH_ISAPS);
  });

  it('a Middle teacher who later adds High gets I-SAPS with no data change', async () => {
    seed({ teacherLevel: ['MIDDLE'] });
    expect(await vendorsOf()).toEqual(NOT_ISAPS);
    tableStates.users.rows[0].teacher_level = ['MIDDLE', 'HIGH'];
    expect(await vendorsOf()).toEqual(WITH_ISAPS);
  });

  it('a lookup that fails leaves her list as it was (never hides on an error)', async () => {
    // Middle-only, no work: the gate WOULD hide I-SAPS, but it cannot read her band, so nothing changes
    seed({ teacherLevel: ['MIDDLE'] });
    tableStates.users = { error: { message: 'boom' } };
    expect(await vendorsOf()).toEqual(WITH_ISAPS);
    seed({ teacherLevel: ['MIDDLE'] });
    tableStates.training_certificates = { error: { message: 'boom' } };
    expect(await vendorsOf()).toEqual(WITH_ISAPS);
  });
});

describe('bd-r2uzg1.18.1 — the coach card lists the trainings she sees', () => {
  // dashboard/services/coach-school-card.service.js reads her trainings in SQL, "as GET /training/vendors reads them"
  const SCOPES = [
    ['p-mh', 'niete_middle_high', 'v-niete', [3, 4]], ['p-mh', 'niete_middle_high', 'v-isaps', null],
    ['p-mh', 'niete_middle_high', 'v-bh', null], ['p-mh', 'niete_middle_high', 'v-ox', null],
  ];
  const LEVELS = [['v-niete', 'TALEEMABAD', 3], ['v-niete', 'TALEEMABAD', 4], ['v-isaps', 'ISAPS', 27], ['v-bh', 'BEACONHOUSE', 40], ['v-ox', 'OXBRIDGE', 50]];

  function cardQuery(teachers, work = []) {
    const calls = [];
    const query = async (sql, params) => {
      const tag = (String(sql).match(/\/\* sc:([a-z-]+) \*\//) || [])[1];
      calls.push(tag);
      if (tag === 'training-scopes') {
        return { rows: teachers.filter(t => params[0].includes(t.id)).flatMap(t => SCOPES.map(([program_id, program_key, vendor_id, level_ids]) => ({
          user_id: t.id, program_id, program_key, teacher_level: t.teacher_level, vendor_id, level_ids,
        }))) };
      }
      if (tag === 'training-levels') {
        return { rows: LEVELS.filter(([v]) => params[0].includes(v)).map(([vendor_id, vendor_key, level_id]) => ({
          vendor_id, vendor_key, vendor_name: vendor_key, unlock_logic: 'all_modules', level_id, order_index: 0, parts: 2,
        })) };
      }
      if (tag === 'training-done') return { rows: [] };
      if (tag === 'training-band-work') return { rows: work.filter(w => params[0].includes(w.user_id) && params[1].includes(w.vendor_id)) };
      throw new Error(`unexpected read ${tag}`);
    };
    return { query, calls };
  }
  const keysOf = (map, id) => map.get(id).vendors.map(v => v.vendor_key).sort();

  it('a Middle-only teacher has no I-SAPS row; a High one and a Middle one with I-SAPS work do', async () => {
    const Card = require('../../dashboard/services/coach-school-card.service');
    const teachers = [
      { id: 'u-mid', teacher_level: ['MIDDLE'] },
      { id: 'u-high', teacher_level: ['MIDDLE', 'HIGH'] },
      { id: 'u-mid-work', teacher_level: ['MIDDLE'] },
    ];
    const { query, calls } = cardQuery(teachers, [{ user_id: 'u-mid-work', vendor_id: 'v-isaps' }]);
    const out = await Card.internals.trainingsOf(query, teachers.map(t => t.id));
    expect(keysOf(out, 'u-mid')).toEqual(NOT_ISAPS);
    expect(keysOf(out, 'u-high')).toEqual(WITH_ISAPS);
    expect(keysOf(out, 'u-mid-work')).toEqual(WITH_ISAPS);
    expect(out.get('u-mid').levels.map(l => l.id)).not.toContain(27);
    expect(calls.filter(t => t === 'training-band-work')).toHaveLength(1);
  });

  it('no gated teacher on the list: no extra read; a failed work read keeps the rows', async () => {
    const Card = require('../../dashboard/services/coach-school-card.service');
    const high = cardQuery([{ id: 'u-high', teacher_level: ['MIDDLE', 'HIGH'] }]);
    await Card.internals.trainingsOf(high.query, ['u-high']);
    expect(high.calls).not.toContain('training-band-work');

    const broken = cardQuery([{ id: 'u-mid', teacher_level: ['MIDDLE'] }]);
    const failing = async (sql, params) => {
      if (String(sql).includes('sc:training-band-work')) throw new Error('boom');
      return broken.query(sql, params);
    };
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(keysOf(await Card.internals.trainingsOf(failing, ['u-mid']), 'u-mid')).toEqual(WITH_ISAPS);
  });
});

describe('bd-r2uzg1.18.1 — the rule itself', () => {
  it('names I-SAPS as a HIGH-only vendor and gates only the band programmes band selection assigns', () => {
    const Rules = require('../../bot/shared/services/training/vendor-band-gate.rules');
    const { PROGRAM_PRIMARY, PROGRAM_MIDDLE_HIGH } = require('../../bot/shared/services/training/band-selection.service');
    expect(Rules.requiredBand('ISAPS')).toBe('HIGH');
    expect(Rules.requiredBand('BEACONHOUSE')).toBeNull();
    expect([...Rules.BAND_PROGRAM_KEYS].sort()).toEqual([PROGRAM_MIDDLE_HIGH, PROGRAM_PRIMARY].sort());
  });
});
