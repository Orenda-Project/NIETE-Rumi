'use strict';
/**
 * The coach edit's phone change, pinned before its move is shared (characterisation).
 *
 * The coach app's Edit teacher saves a new number through POST /api/internal/observe/teacher-edit (edit 'phone'),
 * which calls teacher-edit-commit.service commitPhone. Its move (retire a shell, move the number, move the booked
 * visits, re-parent the shell's rows) becomes a routine that WhatsApp's own number-change notice also calls. These
 * tests write down what the coach path does, write by write, so the extraction can be shown to change nothing:
 * every database write in order (table, filter, payload), the audit row, and what the screen gets back, for each
 * case the screen can reach. They were green on the code before the extraction and are unchanged after it.
 *
 * Faked: the Supabase client (in memory; every write recorded in order, any write can be refused) and the logger.
 * Real: the service, the planners, the patch resolver and the route. The clock is fixed, so a retired shell's
 * tombstone is exact. Numbers are built from parts, so the file holds no phone-shaped literal.
 */

let tables;
let writes;
let refuse; // (table, op, payload, where) => true to answer that write with an error
let refuseRead; // (table) => true to answer a read of that table with an error
let throwWrite; // (table, op, payload) => true to make that write reject, as a dropped connection would

function fakeSupabase() {
  return {
    from(name) {
      const t = tables[name] || (tables[name] = []);
      const filters = [];
      let op = 'select';
      let patch = null;
      let inserted = null;
      let headCount = false;
      let single = false;
      let returning = false;
      const match = (row) => filters.every(([kind, c, v]) => (kind === 'eq' ? row[c] === v : v.includes(row[c])));
      const where = () => filters.map(([kind, c, v]) => [kind, c, Array.isArray(v) ? [...v] : v]);
      const run = () => {
        if (op === 'insert') {
          writes.push({ table: name, op, rows: inserted.map((r) => JSON.parse(JSON.stringify(r))) });
          if (refuse(name, op, inserted, where())) return { data: null, error: { message: `insert ${name} refused` } };
          t.push(...inserted);
          return { data: null, error: null };
        }
        if (op === 'update') {
          writes.push({ table: name, op, patch: { ...patch }, where: where() });
          if (throwWrite(name, op, patch)) throw new Error('connection reset');
          if (refuse(name, op, patch, where())) return { data: null, error: { message: `update ${name} refused` } };
          const hits = t.filter(match);
          hits.forEach((r) => Object.assign(r, patch));
          return { data: returning ? hits.map((r) => ({ ...r })) : null, error: null };
        }
        if (refuseRead(name)) return { data: null, count: null, error: { message: `select ${name} refused` } };
        const hits = t.filter(match);
        if (headCount) return { data: null, count: hits.length, error: null };
        if (single) return { data: hits[0] ? { ...hits[0] } : null, error: null };
        return { data: hits.map((r) => ({ ...r })), error: null };
      };
      const chain = {
        select(_cols, opts) { if (opts && opts.head) headCount = true; if (op === 'update') returning = true; return chain; },
        eq(c, v) { filters.push(['eq', c, v]); return chain; },
        in(c, v) { filters.push(['in', c, v]); return chain; },
        limit() { return chain; },
        maybeSingle() { single = true; return chain; },
        update(p) { op = 'update'; patch = p; return chain; },
        insert(rows) { op = 'insert'; inserted = Array.isArray(rows) ? rows : [rows]; return chain; },
        then(resolve, reject) { try { resolve(run()); } catch (e) { reject(e); } },
      };
      return chain;
    },
  };
}

// A Pakistani mobile in stored form (92 3xx xxxxxxx), built from parts.
const mob = (n) => ['92', '300', String(n).padStart(7, '0')].join('');
const local = (stored) => `0${stored.slice(2, 5)} ${stored.slice(5)}`; // as a coach types it: 03xx xxxxxxx

const ME = 'coach-1';
const SCHOOL = 'niete:110';
const OLD = mob(1110001);
const SHELL_PHONE = mob(2220002);
const REAL_PHONE = mob(3330003);
const FREE = mob(4445556);
const NOW = Date.parse('2026-11-08T09:00:00.000Z');
const TOMBSTONE = { deleted_at: '2026-11-08T09:00:00.000Z', deleted_reason: 'phone_change_merge', deleted_by: ME };
const TAKEN = {
  ok: false,
  reason: 'taken',
  heading: 'Please wait while we fix your data',
  message: 'This change will take some time, please check back later.',
};

beforeEach(() => {
  jest.resetModules();
  tables = {
    leader_schools: [{ leader_user_id: ME, school_ext_id: SCHOOL, school_id: 'sch-110' }],
    schools: [
      { id: 'sch-110', name: 'IMSG I-10/1', emis: '110' },
      { id: 'sch-999', name: 'Not Hers', emis: '999' },
    ],
    users: [
      { id: 'u-ayesha', phone_number: OLD, name: 'Ayesha Bibi', role: 'teacher', school_id: 'sch-110', teacher_level: ['PRIMARY'], teacher_level_updated_at: null },
      { id: 'u-other', phone_number: mob(1110009), name: 'Other School', role: 'teacher', school_id: 'sch-999', teacher_level: ['HIGH'], teacher_level_updated_at: null },
      { id: 'u-shell', phone_number: SHELL_PHONE, name: 'Shell Account', role: 'teacher', school_id: null },
      { id: 'u-real', phone_number: REAL_PHONE, name: 'Real Teacher', role: 'teacher', school_id: null },
    ],
    training_certificates: [{ id: 'c1', user_id: 'u-real' }],
    training_assessment_attempts: [],
    teacher_training_progress: [],
    coaching_sessions: [],
    observation_schedules: [{ id: 'v1', teacher_ext_id: OLD, status: 'upcoming' }],
    leader_roster_audit: [],
  };
  writes = [];
  refuse = () => false;
  refuseRead = () => false;
  throwWrite = () => false;
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
  jest.doMock('../../bot/shared/config/supabase', () => fakeSupabase());
});

afterEach(() => { jest.restoreAllMocks(); jest.resetModules(); });

const svc = () => require('../../bot/shared/services/observe/teacher-edit-commit.service');
const user = (id) => tables.users.find((u) => u.id === id);
const base = { actorLeaderUserId: ME, schoolExtId: SCHOOL, userId: 'u-ayesha' };

/** The coach's audit row, as the service writes it. */
const auditRow = (action, detail) => ({
  action,
  actor_user_id: ME,
  affected_leader_user_id: ME,
  teacher_ext_id: 'u-ayesha',
  teacher_phone_e164: OLD,
  teacher_name: 'Ayesha Bibi',
  detail: { via: 'portal_coach_v2', ...detail },
});

const W = {
  phone: (to) => ({ table: 'users', op: 'update', patch: { phone_number: to }, where: [['eq', 'id', 'u-ayesha']] }),
  retire: (id) => ({ table: 'users', op: 'update', patch: { ...TOMBSTONE, phone_number: `merged:${id}` }, where: [['eq', 'id', id]] }),
  visits: (to) => ({ table: 'observation_schedules', op: 'update', patch: { teacher_ext_id: to }, where: [['eq', 'teacher_ext_id', OLD]] }),
  // The three tables with no unique key move in one update each, rows or not.
  moveAll: (table, shell) => ({ table, op: 'update', patch: { user_id: 'u-ayesha' }, where: [['eq', 'user_id', shell]] }),
  moveSome: (table, owner, ids, shell) => ({
    table, op: 'update', patch: { [owner]: 'u-ayesha' }, where: [['in', 'id', ids], ['eq', owner, shell]],
  }),
  audit: (row) => ({ table: 'leader_roster_audit', op: 'insert', rows: [row] }),
};

/** A shell with nothing of its own: the unkeyed tables are still written, once each, in REPARENT order. */
const emptyShellMoves = (shell) => [
  W.moveAll('niete_lp_opens', shell),
  W.moveAll('training_assessment_attempts', shell),
  W.moveAll('coaching_sessions', shell),
];
const ZERO_REPARENTED = {
  niete_lp_opens: 0, student_lists: 0, class_teachers: 0, teacher_nudges: 0,
  teacher_training_progress: 0, training_assessment_attempts: 0, training_certificates: 0, coaching_sessions: 0,
};

describe('commitPhone: what the coach path writes, in order', () => {
  test('a free number: her number, then her booked visits, then one edit_phone audit row', async () => {
    const out = await svc().commitPhone({ ...base, phone: FREE });
    expect(out).toEqual({ ok: true, outcome: 'moved', phone: FREE, case: 'free' });
    expect(writes).toEqual([
      W.phone(FREE),
      W.visits(FREE),
      W.audit(auditRow('edit_phone', { from_phone: OLD, to_phone: FREE, case: 'free', retired_user_id: null })),
    ]);
    expect(user('u-ayesha').phone_number).toBe(FREE);
    expect(tables.observation_schedules[0].teacher_ext_id).toBe(FREE);
  });

  test('the number as a coach types it (03xx with a space) is stored as 92…, the same writes', async () => {
    const out = await svc().commitPhone({ ...base, phone: local(FREE) });
    expect(out).toEqual({ ok: true, outcome: 'moved', phone: FREE, case: 'free' });
    expect(writes.map((w) => w.table)).toEqual(['users', 'observation_schedules', 'leader_roster_audit']);
    expect(writes[0]).toEqual(W.phone(FREE));
  });

  test('a shell number: the shell retired first (tombstone, merged:<id>), then the move, then its rows, then the audit', async () => {
    const out = await svc().commitPhone({ ...base, phone: SHELL_PHONE });
    expect(out).toEqual({ ok: true, outcome: 'moved', phone: SHELL_PHONE, case: 'shell' });
    expect(writes).toEqual([
      W.retire('u-shell'),
      W.phone(SHELL_PHONE),
      W.visits(SHELL_PHONE),
      ...emptyShellMoves('u-shell'),
      W.audit(auditRow('edit_phone', {
        from_phone: OLD, to_phone: SHELL_PHONE, case: 'shell', retired_user_id: 'u-shell', reparented: ZERO_REPARENTED,
      })),
    ]);
    expect(user('u-shell')).toEqual(expect.objectContaining({ ...TOMBSTONE, phone_number: 'merged:u-shell' }));
    expect(user('u-ayesha').phone_number).toBe(SHELL_PHONE);
  });

  test('a shell with rows of its own: each keyed table moves only what she has no equal of, by id', async () => {
    const YEAR = '2026-27';
    tables.niete_lp_opens = [{ id: 'o1', user_id: 'u-shell' }, { id: 'o2', user_id: 'u-shell' }];
    tables.student_lists = [
      { id: 'sl-3a', user_id: 'u-shell', class_name: 'Grade 3-A', academic_year: YEAR, is_active: true },
      { id: 'sl-4a', user_id: 'u-shell', class_name: 'Grade 4-A', academic_year: YEAR, is_active: true },
      { id: 'sl-4a-hers', user_id: 'u-ayesha', class_name: 'grade 4-a', academic_year: YEAR, is_active: true },
    ];
    tables.class_teachers = [{ id: 'ct-3a', class_id: 'cls-3a', teacher_user_id: 'u-shell', is_active: true }];
    tables.teacher_nudges = [
      { id: 'n-26', user_id: 'u-shell', nudge_date: '2026-10-26', kind: 'lp_quiz_offer' },
      { id: 'n-27', user_id: 'u-shell', nudge_date: '2026-10-27', kind: 'lp_quiz_offer' },
      { id: 'n-27-hers', user_id: 'u-ayesha', nudge_date: '2026-10-27', kind: 'lp_quiz_offer' },
    ];
    const out = await svc().commitPhone({ ...base, phone: SHELL_PHONE });
    expect(out).toEqual({ ok: true, outcome: 'moved', phone: SHELL_PHONE, case: 'shell' });
    expect(writes).toEqual([
      W.retire('u-shell'),
      W.phone(SHELL_PHONE),
      W.visits(SHELL_PHONE),
      W.moveAll('niete_lp_opens', 'u-shell'),
      W.moveSome('student_lists', 'user_id', ['sl-3a'], 'u-shell'),
      W.moveSome('class_teachers', 'teacher_user_id', ['ct-3a'], 'u-shell'),
      W.moveSome('teacher_nudges', 'user_id', ['n-26'], 'u-shell'),
      W.moveAll('training_assessment_attempts', 'u-shell'),
      W.moveAll('coaching_sessions', 'u-shell'),
      W.audit(auditRow('edit_phone', {
        from_phone: OLD,
        to_phone: SHELL_PHONE,
        case: 'shell',
        retired_user_id: 'u-shell',
        reparented: { ...ZERO_REPARENTED, niete_lp_opens: 2, student_lists: 1, class_teachers: 1, teacher_nudges: 1 },
        reparent_skipped: { student_lists: 1, teacher_nudges: 1 },
      })),
    ]);
  });

  test("a taken number: nothing moves; the escalation row is the only write, and the screen gets main's words", async () => {
    const out = await svc().commitPhone({ ...base, phone: REAL_PHONE });
    expect(out).toEqual(TAKEN);
    expect(writes).toEqual([
      W.audit(auditRow('edit_phone_escalated', { to_phone: REAL_PHONE, reason: 'destination_has_history_at_commit' })),
    ]);
    expect(user('u-ayesha').phone_number).toBe(OLD);
    expect(user('u-real').phone_number).toBe(REAL_PHONE);
  });

  test('an unreadable history on the number reads as taken (fail closed): nothing moves', async () => {
    tables.users.push({ id: 'u-unread', phone_number: mob(5550005), name: 'Unread', role: 'teacher', school_id: null });
    refuseRead = (table) => table === 'coaching_sessions';
    const out = await svc().commitPhone({ ...base, phone: mob(5550005) });
    expect(out).toEqual(TAKEN);
    expect(writes.map((w) => [w.table, w.op, w.rows && w.rows[0].action])).toEqual([['leader_roster_audit', 'insert', 'edit_phone_escalated']]);
    expect(user('u-unread').phone_number).toBe(mob(5550005));
  });

  test('her own number, typed any way: unchanged, nothing written', async () => {
    for (const typed of [OLD, local(OLD), `+${OLD}`]) {
      // eslint-disable-next-line no-await-in-loop
      expect(await svc().commitPhone({ ...base, phone: typed })).toEqual({ ok: true, outcome: 'unchanged', phone: OLD });
    }
    expect(writes).toEqual([]);
  });

  test('not a Pakistani mobile: invalid_phone, nothing written', async () => {
    expect(await svc().commitPhone({ ...base, phone: '12345' })).toEqual({ ok: false, reason: 'invalid_phone' });
    expect(writes).toEqual([]);
  });

  test('a teacher outside her roster at that school: not_found, nothing written', async () => {
    expect(await svc().commitPhone({ ...base, userId: 'u-other', phone: FREE })).toEqual({ ok: false, reason: 'not_found' });
    expect(await svc().commitPhone({ ...base, schoolExtId: 'niete:999', phone: FREE })).toEqual({ ok: false, reason: 'not_found' });
    expect(writes).toEqual([]);
  });

  test('the shell retirement refused: failed, and nothing after it is attempted', async () => {
    refuse = (table, op, patch) => table === 'users' && op === 'update' && String(patch.phone_number).startsWith('merged:');
    const out = await svc().commitPhone({ ...base, phone: SHELL_PHONE });
    expect(out).toEqual({ ok: false, reason: 'failed' });
    expect(writes).toEqual([W.retire('u-shell')]);
    expect(user('u-shell').phone_number).toBe(SHELL_PHONE);
    expect(user('u-ayesha').phone_number).toBe(OLD);
  });

  test('her number write refused after the shell was retired: failed, the retirement stands, no visit or audit write', async () => {
    refuse = (table, op, patch) => table === 'users' && op === 'update' && patch.phone_number === SHELL_PHONE;
    const out = await svc().commitPhone({ ...base, phone: SHELL_PHONE });
    expect(out).toEqual({ ok: false, reason: 'failed' });
    expect(writes).toEqual([W.retire('u-shell'), W.phone(SHELL_PHONE)]);
    expect(user('u-shell').phone_number).toBe('merged:u-shell');
    expect(user('u-ayesha').phone_number).toBe(OLD);
  });

  test('her number write refused on a free number: failed, no visit or audit write', async () => {
    refuse = (table, op) => table === 'users' && op === 'update';
    expect(await svc().commitPhone({ ...base, phone: FREE })).toEqual({ ok: false, reason: 'failed' });
    expect(writes).toEqual([W.phone(FREE)]);
  });

  test('her booked visits refused: the move stands, the coach still gets moved, and the move is audited', async () => {
    refuse = (table) => table === 'observation_schedules';
    const out = await svc().commitPhone({ ...base, phone: FREE });
    expect(out).toEqual({ ok: true, outcome: 'moved', phone: FREE, case: 'free' });
    expect(user('u-ayesha').phone_number).toBe(FREE);
    expect(tables.observation_schedules[0].teacher_ext_id).toBe(OLD);
    expect(writes).toEqual([
      W.phone(FREE),
      W.visits(FREE),
      W.audit(expect.objectContaining({
        ...auditRow('edit_phone', {}),
        detail: expect.objectContaining({ via: 'portal_coach_v2', from_phone: OLD, to_phone: FREE, case: 'free', retired_user_id: null }),
      })),
    ]);
  });

  test('a shell table refused while it hands over: the move stands, the coach still gets moved, the audit names the table', async () => {
    tables.student_lists = [{ id: 'sl-3a', user_id: 'u-shell', class_name: 'Grade 3-A', academic_year: '2026-27', is_active: true }];
    refuse = (table, op) => table === 'student_lists' && op === 'update';
    const out = await svc().commitPhone({ ...base, phone: SHELL_PHONE });
    expect(out).toEqual({ ok: true, outcome: 'moved', phone: SHELL_PHONE, case: 'shell' });
    expect(user('u-ayesha').phone_number).toBe(SHELL_PHONE);
    expect(tables.student_lists[0].user_id).toBe('u-shell');
    expect(writes.filter((w) => w.table === 'leader_roster_audit').map((w) => w.rows[0])).toEqual([expect.objectContaining({
      ...auditRow('edit_phone', {}),
      detail: expect.objectContaining({
        from_phone: OLD, to_phone: SHELL_PHONE, case: 'shell', retired_user_id: 'u-shell', reparent_failed: ['student_lists'],
      }),
    })]);
  });

  test('a write that throws mid-move: commitPhone rejects (the route answers 500), and nothing after it is attempted', async () => {
    throwWrite = (table, op, patch) => table === 'users' && patch.phone_number === FREE;
    await expect(svc().commitPhone({ ...base, phone: FREE })).rejects.toThrow('connection reset');
    expect(writes).toEqual([W.phone(FREE)]);
  });

  test('the audit insert refused: the move stands and the screen still says moved', async () => {
    refuse = (table) => table === 'leader_roster_audit';
    expect(await svc().commitPhone({ ...base, phone: FREE })).toEqual({ ok: true, outcome: 'moved', phone: FREE, case: 'free' });
    expect(user('u-ayesha').phone_number).toBe(FREE);
  });
});

describe('POST /api/internal/observe/teacher-edit: what the coach screen receives for a phone change', () => {
  const KEY = 'shared-secret-key';
  let router;

  function findRoute(r, path) {
    for (const layer of r.stack) {
      if (layer.route && layer.route.methods.post && layer.route.path === path) return layer.route.stack.map((s) => s.handle);
    }
    return null;
  }
  async function post(body) {
    const stack = findRoute(router, '/observe/teacher-edit');
    if (!stack) throw new Error('route POST /observe/teacher-edit not found');
    const req = { headers: { 'x-api-key': KEY }, body, ip: '127.0.0.1', method: 'POST', path: '/observe/teacher-edit' };
    let statusCode = 200;
    let payload = null;
    const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
    let advanced = true;
    for (const h of stack) {
      if (!advanced) break;
      advanced = false;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        const m = h(req, res, () => { advanced = true; resolve(); });
        if (m && typeof m.then === 'function') m.then(() => resolve(), () => resolve());
        else if (!advanced) resolve();
      });
    }
    return { statusCode, payload };
  }
  const edit = (edit, value, extra = {}) => post({ leaderUserId: ME, schoolExtId: SCHOOL, userId: 'u-ayesha', edit, value, ...extra });

  beforeEach(() => {
    process.env.INTERNAL_API_KEY = KEY;
    router = require('../../bot/shared/routes/internal-api.routes');
  });
  afterEach(() => { delete process.env.INTERNAL_API_KEY; });

  test('phone, free: 200 with the outcome, the stored number and the case', async () => {
    expect(await edit('phone', local(FREE))).toEqual({ statusCode: 200, payload: { success: true, outcome: 'moved', phone: FREE, case: 'free' } });
  });

  test('phone, shell: 200, case shell', async () => {
    expect(await edit('phone', SHELL_PHONE)).toEqual({ statusCode: 200, payload: { success: true, outcome: 'moved', phone: SHELL_PHONE, case: 'shell' } });
  });

  test("phone, taken: 409 with main's words and nothing about why", async () => {
    const { ok, ...rest } = TAKEN;
    expect(await edit('phone', REAL_PHONE)).toEqual({ statusCode: 409, payload: { success: false, ...rest } });
  });

  test('phone, her own number: 200 unchanged', async () => {
    expect(await edit('phone', OLD)).toEqual({ statusCode: 200, payload: { success: true, outcome: 'unchanged', phone: OLD } });
  });

  test('phone, not a mobile: 400 invalid_phone; outside her roster: 404; a refused write: 500 failed', async () => {
    expect(await edit('phone', '12345')).toEqual({ statusCode: 400, payload: { success: false, reason: 'invalid_phone' } });
    expect(await edit('phone', FREE, { userId: 'u-other' })).toEqual({ statusCode: 404, payload: { success: false, reason: 'not_found' } });
    refuse = (table, op) => table === 'users' && op === 'update';
    expect(await edit('phone', FREE)).toEqual({ statusCode: 500, payload: { success: false, reason: 'failed' } });
  });

  test('phone_check (the step before): free, shell and unchanged read only; taken writes only its escalation row', async () => {
    expect(await edit('phone_check', FREE)).toEqual({ statusCode: 200, payload: { success: true, outcome: 'free', phone: FREE, from: OLD } });
    expect(await edit('phone_check', SHELL_PHONE)).toEqual({ statusCode: 200, payload: { success: true, outcome: 'shell', phone: SHELL_PHONE, from: OLD } });
    expect(await edit('phone_check', OLD)).toEqual({ statusCode: 200, payload: { success: true, outcome: 'unchanged', phone: OLD } });
    expect(writes).toEqual([]);
    const { ok, ...rest } = TAKEN;
    expect(await edit('phone_check', REAL_PHONE)).toEqual({ statusCode: 409, payload: { success: false, ...rest } });
    expect(writes).toEqual([
      W.audit(auditRow('edit_phone_escalated', { to_phone: REAL_PHONE, reason: 'destination_has_history' })),
    ]);
  });
});
