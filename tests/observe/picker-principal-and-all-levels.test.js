'use strict';
/**
 * bd-r2uzg1.18.5 — the coach's WhatsApp /observe teacher pickers say who a person IS.
 *
 * Two reports from the field, one screen:
 *
 * (a) A coach changed someone's role to Principal. Manage teachers then said "Principal", but the
 *     Observe teacher list still said "PRIMARY", so the coach thought the change had not saved. It had
 *     (users.role = 'principal'). The Observe row is built by teacherMeta, which printed the teaching
 *     level and the last visit and never the role; listTeachers did not even carry is_principal.
 *
 * (b) A teacher who teaches Primary, Middle and High showed as "primary" in the coach's lists while
 *     her profile showed all three, so coaches thought the record was wrong and re-edited it. The
 *     pickers printed bandOf() = the LOWEST band only. On prod (19 Nov) 2,160 rostered teachers and
 *     principals hold more than one level.
 *
 * The fix is display only: every picker prints the SAME label for a person — "Principal" for a
 * principal (Manage teachers' own word), otherwise every band she teaches ("Primary + Middle + High").
 * `level` keeps its single value for the code that needs one.
 *
 * The real handler, leader-source and patch-resolver run here over an in-memory supabase.
 * Made-up people and numbers only.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const mockState = { tables: {} };

function mockTable(name) {
  let out = [...(mockState.tables[name] || [])];
  const q = {
    select() { return q; },
    eq(c, v) { out = out.filter((r) => r[c] === v); return q; },
    is(c, v) { out = out.filter((r) => (v === null ? r[c] == null : r[c] === v)); return q; },
    in(c, vs) { out = out.filter((r) => vs.includes(r[c])); return q; },
    order() { return q; },
    limit(n) { out = out.slice(0, n); return q; },
    maybeSingle() { return Promise.resolve({ data: out[0] || null, error: null }); },
    then(res, rej) { return Promise.resolve({ data: out, error: null }).then(res, rej); },
  };
  return q;
}

jest.mock('../../bot/shared/config/supabase', () => ({ from: (n) => mockTable(n) }));
// No redis in a unit test: the picker's "remember what she tapped" is a side effect, not the subject.
jest.mock('../../bot/shared/services/observe/observe-state.service', () => ({
  setState: async () => {}, getState: async () => null, clearState: async () => {},
}));
jest.mock('../../bot/shared/services/observe/observe-debrief.service', () => ({
  listPendingDebriefs: async () => [], listUnsentReports: async () => [], listUnfinished: async () => [],
}));

const H = require('../../bot/shared/handlers/observe-visit-flow.handler');
const { shapePatchRow, toLeaderSourceRow } = require('../../bot/shared/services/observe/patch-resolver.service');

const COACH = 'coach-1';
const SCHOOL = 'niete:701';

const PEOPLE = {
  multi: { id: 'u-multi', phone_number: '923000000101', name: 'Teacher Multi', role: 'teacher', teacher_level: ['HIGH', 'PRIMARY', 'MIDDLE'] },
  single: { id: 'u-single', phone_number: '923000000102', name: 'Teacher Single', role: 'teacher', teacher_level: ['MIDDLE'] },
  head: { id: 'u-head', phone_number: '923000000103', name: 'Head Example', role: 'principal', teacher_level: ['PRIMARY'] },
  unknown: { id: 'u-unknown', phone_number: '923000000104', name: 'Teacher Unknown', role: 'teacher', teacher_level: null },
};

beforeEach(() => {
  mockState.tables = {
    users: [
      { id: COACH, phone_number: '923000000100', name: 'Coach Example', role: 'coach', school_id: null, deleted_at: null },
      ...Object.values(PEOPLE).map((p) => ({ ...p, school_id: 's-701', deleted_at: null })),
    ],
    leader_schools: [{ leader_user_id: COACH, school_ext_id: SCHOOL, school_id: 's-701', school_name: 'Example School', emis: '701' }],
    schools: [{ id: 's-701', name: 'Example School', emis: '701' }],
    coaching_sessions: [],
    app_settings: [],
  };
});

const cp = (s) => [...String(s == null ? '' : s)].length;
const LABEL = {
  multi: 'Primary + Middle + High',
  single: 'Middle',
  head: 'Principal',
};

// ── the Observe picker (SELECT_TEACHER) ────────────────────────────────────────────────────────────

describe('Observe · pick a teacher (v2 Dropdown)', () => {
  const pick = async () => {
    const r = await H.handle(COACH, 'data_exchange', 'SELECT_SCHOOL', { step: 'school', picked: SCHOOL }, COACH, null);
    expect(r.screen).toBe('SELECT_TEACHER');
    return Object.fromEntries(r.data.options.map((o) => [o.id, o]));
  };

  test('(a) a principal leads with "Principal", never her teaching band', async () => {
    const row = (await pick())[PEOPLE.head.phone_number];
    expect(row.metadata.startsWith('Principal')).toBe(true);
    expect(row.metadata).not.toMatch(/primary/i);
  });

  test('(b) a teacher of three levels shows all three, in canonical order', async () => {
    const row = (await pick())[PEOPLE.multi.phone_number];
    expect(row.metadata.startsWith(`${LABEL.multi} · `)).toBe(true);
  });

  test('a one-level teacher shows that level, in the same words', async () => {
    const row = (await pick())[PEOPLE.single.phone_number];
    expect(row.metadata.startsWith(`${LABEL.single} · `)).toBe(true);
  });

  test('no level on record prints none — never a guessed band', async () => {
    const row = (await pick())[PEOPLE.unknown.phone_number];
    expect(row.metadata).toBe('Not yet visited');
  });

  test('every row fits the Flow caps whole (title 30, description 30, metadata 80)', async () => {
    for (const o of Object.values(await pick())) {
      expect(cp(o.title)).toBeLessThanOrEqual(30);
      expect(cp(o.description)).toBeLessThanOrEqual(30);
      expect(cp(o.metadata)).toBeLessThanOrEqual(80);
      expect(o.metadata.endsWith('…')).toBe(false);
    }
  });
});

describe('Observe · search by name lands on the same rows', () => {
  test('a principal found by search still reads "Principal"', async () => {
    const r = await H.handle(COACH, 'data_exchange', 'SELECT_SCHOOL', { step: 'teacher_search', term: 'head' }, COACH, null);
    expect(r.data.options).toHaveLength(1);
    expect(r.data.options[0].metadata.startsWith('Principal')).toBe(true);
  });
});

describe('Observe · the legacy NavigationList (v1 Flow) reads the same', () => {
  test('principal and multi-level rows', async () => {
    const r = await H.handle(COACH, 'data_exchange', 'SELECT_SCHOOL', { step: 'school', school_ext_id: SCHOOL }, COACH, null);
    const byId = Object.fromEntries(r.data.items.map((i) => [i.id, i['main-content']]));
    expect(byId[PEOPLE.head.phone_number].metadata.startsWith('Principal')).toBe(true);
    expect(byId[PEOPLE.head.phone_number].metadata).not.toMatch(/primary/i);
    expect(byId[PEOPLE.multi.phone_number].metadata.startsWith(`${LABEL.multi} · `)).toBe(true);
  });
});

// ── Manage teachers (TEACHER_EDIT_PICK / TEACHER_PICK) ─────────────────────────────────────────────

describe.each([
  ['teacher_edit_open', 'TEACHER_EDIT_PICK'],
  ['teacher_remove_open', 'TEACHER_PICK'],
])('Manage teachers · %s', (step, screen) => {
  const open = async () => {
    const r = await H.handle(COACH, 'data_exchange', 'TEACHER_SCHOOL', { step, school_ext_id: SCHOOL }, COACH, null);
    expect(r.screen).toBe(screen);
    return Object.fromEntries(r.data.options.map((o) => [o.id, o]));
  };

  test('(b) a teacher of three levels shows all three, not just "primary"', async () => {
    expect((await open())[PEOPLE.multi.id].description).toBe(LABEL.multi);
  });

  test('a one-level teacher and a principal keep reading as before, in the shared words', async () => {
    const rows = await open();
    expect(rows[PEOPLE.single.id].description).toBe(LABEL.single);
    expect(rows[PEOPLE.head.id].description).toBe(LABEL.head);
    expect(rows[PEOPLE.unknown.id].description).toBe('');
  });
});

// ── one person, one label, on every screen ─────────────────────────────────────────────────────────

describe('the Observe list and Manage teachers can no longer disagree', () => {
  test('each person\'s Observe label equals her Manage-teachers label', async () => {
    const obs = await H.handle(COACH, 'data_exchange', 'SELECT_SCHOOL', { step: 'school', picked: SCHOOL }, COACH, null);
    const mng = await H.handle(COACH, 'data_exchange', 'TEACHER_SCHOOL', { step: 'teacher_edit_open', school_ext_id: SCHOOL }, COACH, null);
    const obsByPhone = Object.fromEntries(obs.data.options.map((o) => [o.id, o.metadata]));
    for (const key of ['multi', 'single', 'head']) {
      const p = PEOPLE[key];
      const manage = mng.data.options.find((o) => o.id === p.id).description;
      expect(obsByPhone[p.phone_number].split(' · ')[0]).toBe(manage);
    }
  });
});

// ── the single value code relies on is unchanged ───────────────────────────────────────────────────

describe('`level` stays one band for the code that needs one', () => {
  test('toLeaderSourceRow(...).level is still the lowest band, uppercase', () => {
    const row = toLeaderSourceRow(shapePatchRow({ ...PEOPLE.multi, user_id: PEOPLE.multi.id, school_id: 's-701', emis: '701' }));
    expect(row.level).toBe('PRIMARY');
  });
});
