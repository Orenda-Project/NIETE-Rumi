/**
 * v10 coaching test (bd-v0toag.130): the app's coaching report served the v10 thing to try to every group.
 *
 * The bot stores prioritized_action.thing_to_try for all four groups (A and B's check is the comparison);
 * only C and D (the new report) may see it. GET /api/portal/coaching-session/:id returned prioritized_action
 * whole, and the report screen shows thing_to_try.text as "try next" — so A and B saw the treatment.
 *
 * What the tests hold it to:
 *   - C and D, switch on: prioritized_action unchanged;
 *   - A, B, no group, switch off, or any failed read: thing_to_try removed, the rest (her commitment) kept;
 *   - the session detail route serves prioritizedAction through this, never the column as stored.
 */

const fs = require('fs');
const path = require('path');

const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';
const THING = { move_id: 'm4', lesson_id: 'grade_1_english_ch8_seg5', text: 'Ask one child to explain.', tag: 'hlp_peer_talk' };
const PA = { action: 'old', teacher_response: 'yes', thing_to_try: THING };

const S = () => require('../../dashboard/services/thing-to-try.service');

function fakeSupabase(tables, { fail = {} } = {}) {
  return {
    from(table) {
      let rows = [...(tables[table] || [])];
      const done = () => (fail[table] ? { data: null, error: { message: 'boom' } } : null);
      const b = {
        select: () => b,
        eq: (c, v) => { rows = rows.filter((r) => String(r[c]) === String(v)); return b; },
        maybeSingle: async () => done() || { data: rows[0] || null, error: null },
      };
      return b;
    },
  };
}

function world(group, { on = true } = {}) {
  return {
    app_settings: [{ key: 'ab_v10_enabled', value: on ? 'true' : 'false' }],
    users: [{ id: TEACHER, school_id: 's1' }],
    niete_coaching_ab_assignment: group ? [{ school_id: 's1', ab_group: group }] : [],
  };
}

beforeEach(() => {
  jest.resetModules();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); });

describe('actionForTeacher', () => {
  test.each([['C'], ['D']])('%s keeps the thing to try', async (g) => {
    expect(await S().actionForTeacher(fakeSupabase(world(g)), TEACHER, PA)).toEqual(PA);
  });

  test.each([['A'], ['B'], [null]])('group %s: the thing to try is removed, the commitment kept', async (g) => {
    expect(await S().actionForTeacher(fakeSupabase(world(g)), TEACHER, PA)).toEqual({ action: 'old', teacher_response: 'yes' });
  });

  test('switch off: removed, even for D', async () => {
    expect(await S().actionForTeacher(fakeSupabase(world('D', { on: false })), TEACHER, PA)).toEqual({ action: 'old', teacher_response: 'yes' });
  });

  test('a failed group read: removed', async () => {
    const sb = fakeSupabase(world('D'), { fail: { niete_coaching_ab_assignment: true } });
    expect(await S().actionForTeacher(sb, TEACHER, PA)).toEqual({ action: 'old', teacher_response: 'yes' });
  });

  test('no prioritized action, or none with a thing: returned as given, nothing read', async () => {
    const sb = { from: () => { throw new Error('read'); } };
    expect(await S().actionForTeacher(sb, TEACHER, null)).toBeNull();
    expect(await S().actionForTeacher(sb, TEACHER, { action: 'x' })).toEqual({ action: 'x' });
  });
});

test('the session detail route serves prioritizedAction through actionForTeacher', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../dashboard/routes/portal.routes.js'), 'utf8');
  expect(src).not.toMatch(/prioritizedAction:\s*session\.prioritized_action\b/);
  expect(src).toMatch(/prioritizedAction:\s*await ThingToTry\.actionForTeacher\(supabase, userId, session\.prioritized_action\)/);
});
