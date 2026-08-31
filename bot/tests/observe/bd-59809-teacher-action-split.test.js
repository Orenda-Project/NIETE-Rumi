/**
 * bd-59809 — Waheed's field feedback on Add-or-Remove Teacher (2026-08-31,
 * #region-islamabad).
 *
 * Two complaints, both about the coach not being able to tell which of the two
 * actions she is in the middle of:
 *
 *   "When a user selects the option to add a teacher, the remove option
 *    appears as well, even if removal isn't needed."
 *
 * She was right, and the cause is the screen order. Picking a school committed
 * her to ADD — the Footer said "Add a teacher" before she had said which one
 * she wanted — and REMOVE was reachable only as a link buried at the bottom of
 * the add screen, underneath a phone box she had no reason to fill in.
 *
 * The fix puts the choice on its own screen, BETWEEN the school and the phone:
 *   TEACHER_SCHOOL (pick school, "Continue")
 *     -> TEACHER_ACTION (Add or Remove — an explicit choice)
 *        -> TEACHER_ADD (phone) | TEACHER_PICK (dropdown)
 *
 *   "The list currently shows only first names ... several entries look
 *    identical" — fixed in bd-43530 by fullNameOf(); pinned here so a future
 *    picker cannot regress to first_name alone.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OBSERVE_SCHEDULING_UI = 'true';

const flow = require('../../../docs/flows/observe-visit-v2.json');

jest.mock('../../shared/config/supabase', () => ({
  from: () => {
    const q = {
      select: () => q, eq: () => q, in: () => q, is: () => q, not: () => q,
      order: () => q, limit: () => q, maybeSingle: async () => ({ data: null }),
      then: (r) => r({ data: [], error: null }),
    };
    return q;
  },
}));
jest.mock('../../shared/services/observe/observe-schedule.service', () => ({
  listUpcoming: jest.fn(async () => []),
  listPendingDebriefs: jest.fn(async () => []),
}));
jest.mock('../../shared/services/observe/observe-school-admin.service', () => ({
  ...jest.requireActual('../../shared/services/observe/observe-school-admin.service'),
  listMySchools: jest.fn(async () => ([
    { school_ext_id: 'niete:916', school_name: 'IMCG, G-10/2', emis: '916' },
  ])),
}));
jest.mock('../../shared/services/observe/patch-resolver.service', () => {
  const actual = jest.requireActual('../../shared/services/observe/patch-resolver.service');
  return {
    ...actual,
    listPatchViaSupabase: jest.fn(async () => ([
      { userId: 'u1', name: 'Muhammad Kashif Rafique', phone: '923001234567',
        isPrincipal: false, roleLabel: '', band: 'primary',
        schoolName: 'IMCG, G-10/2', emis: '916' },
      { userId: 'u2', name: 'Muhammad Farooq Bashir', phone: '923001234568',
        isPrincipal: false, roleLabel: '', band: 'primary',
        schoolName: 'IMCG, G-10/2', emis: '916' },
    ])),
  };
});

const handler = require('../../shared/handlers/observe-visit-flow.handler');
const screenOf = (id) => flow.screens.find((s) => s.id === id);
const UID = 'coach-a';
const step = (s, data = {}) =>
  handler.handle(UID, 'data_exchange', '', { step: s, ...data }, UID, { id: UID });

// ── 1. full names in the picker ────────────────────────────────────────

describe('Waheed 1 — the picker names the whole teacher', () => {
  it('two Muhammads are told apart by their full names, not just "Muhammad"', async () => {
    const res = await step('teacher_remove_open', { school_ext_id: 'niete:916' });
    const titles = res.data.options.map((o) => o.title);
    expect(titles).toEqual(['Muhammad Kashif Rafique', 'Muhammad Farooq Bashir']);
    // The bug was every row reading the same. Distinctness is the property.
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('fullNameOf prefers the fullest column and never returns a bare first name', () => {
    const { fullNameOf } = require('../../shared/services/observe/patch-resolver.service');
    // 2,531 people on prod look like this: one-word first_name, multi-word name.
    expect(fullNameOf({ first_name: 'Irene', last_name: null, name: 'Irene Khan' }))
      .toBe('Irene Khan');
    // 1,150 three-part names two columns cannot rebuild.
    expect(fullNameOf({ first_name: 'Muhammad', name: 'Muhammad Kashif Rafique' }))
      .toBe('Muhammad Kashif Rafique');
    // 26 rows carry first/last but no `name` — the concatenation is the fallback.
    expect(fullNameOf({ first_name: 'Asad', last_name: 'Amanat Ali' })).toBe('Asad Amanat Ali');
    // 513 carry nothing: null, never the string "null".
    expect(fullNameOf({})).toBeNull();
  });
});

// ── 2. add and remove are separate, explicit choices ───────────────────

describe('Waheed 3 — picking a school does not commit the coach to adding', () => {
  it('the school screen says Continue, not "Add a teacher"', () => {
    const scr = screenOf('TEACHER_SCHOOL');
    const footer = JSON.stringify(scr).match(/"type":"Footer","label":"([^"]+)"/)[1];
    expect(footer).toBe('Continue');
  });

  it('the school screen leads to the CHOICE, not straight into add', () => {
    const scr = screenOf('TEACHER_SCHOOL');
    expect(JSON.stringify(scr)).toContain('"step":"teacher_action_open"');
    expect(JSON.stringify(scr)).not.toContain('teacher_add_open');
  });

  it('teacher_school_open still lists her own schools', async () => {
    const res = await step('teacher_school_open');
    expect(res.screen).toBe('TEACHER_SCHOOL');
    expect(res.data.options.map((o) => o.id)).toContain('niete:916');
  });
});

describe('the new TEACHER_ACTION screen', () => {
  it('exists, and offers exactly the two actions', () => {
    const scr = screenOf('TEACHER_ACTION');
    expect(scr).toBeTruthy();
    const radio = scr.layout.children
      .find((c) => c.type === 'Form').children
      .find((c) => c.type === 'RadioButtonsGroup');
    expect(radio['data-source'].map((o) => o.id)).toEqual(['add', 'remove']);
    expect(radio.required).toBe(true);
  });

  it('carries the school through so the next screen knows where we are', async () => {
    const res = await step('teacher_action_open', { school_ext_id: 'niete:916' });
    expect(res.screen).toBe('TEACHER_ACTION');
    expect(res.data.school_ext_id).toBe('niete:916');
    expect(res.data.intro).toContain('IMCG, G-10/2');
    expect(res.data.intro).not.toContain('${');
  });

  it('choosing Add lands on the phone screen — the SAME add flow as before', async () => {
    const res = await step('teacher_action_pick', { school_ext_id: 'niete:916', action: 'add' });
    expect(res.screen).toBe('TEACHER_ADD');
    expect(res.data.school_ext_id).toBe('niete:916');
  });

  it('choosing Remove lands on the teacher dropdown', async () => {
    const res = await step('teacher_action_pick', { school_ext_id: 'niete:916', action: 'remove' });
    expect(res.screen).toBe('TEACHER_PICK');
    expect(res.data.school_ext_id).toBe('niete:916');
  });

  it('a school that is not hers is refused at the choice, before either path', async () => {
    const res = await step('teacher_action_open', { school_ext_id: 'niete:999' });
    expect(res.screen).toBe('TEACHER_DONE');
  });
});

describe('the add screen no longer offers removal underneath it', () => {
  it('has no "Remove a teacher from this school" escape hatch', () => {
    const scr = JSON.stringify(screenOf('TEACHER_ADD'));
    expect(scr).not.toContain('Remove a teacher from this school');
    expect(scr).not.toContain('teacher_remove_open');
  });

  it('still asks for a number and nothing else', () => {
    const scr = screenOf('TEACHER_ADD');
    const inputs = JSON.stringify(scr).match(/"type":"TextInput"/g) || [];
    expect(inputs).toHaveLength(1);
    expect(JSON.stringify(scr)).toContain('"name":"phone"');
  });
});

// ── the outage class: a screen whose declared keys go unfilled ──────────

describe('every new step fills the keys its screen declares', () => {
  const declared = (sid) => Object.keys((screenOf(sid) || {}).data || {});
  const CASES = [
    ['teacher_action_open', { school_ext_id: 'niete:916' }],
    ['teacher_action_pick', { school_ext_id: 'niete:916', action: 'add' }],
    ['teacher_action_pick', { school_ext_id: 'niete:916', action: 'remove' }],
  ];
  it.each(CASES)('%s (%o) returns every declared key', async (s, data) => {
    const res = await step(s, data);
    const missing = declared(res.screen).filter((k) => !(k in (res.data || {})));
    expect({ screen: res.screen, missing }).toEqual({ screen: res.screen, missing: [] });
  });
});

// ── the routing model, which Meta validates and we did not ─────────────
//
// Learned the hard way on this very bead: publishing TEACHER_ACTION without a
// routing_model entry was REJECTED by Meta with INVALID_ROUTING_MODEL, and the
// live staging Flow dropped from PUBLISHED to DRAFT. A screen can be perfectly
// valid on its own and still take the whole Flow down by not being wired into
// the graph. Every screen must appear, and every edge must point somewhere real.

describe('routing_model — Meta rejects the publish without it', () => {
  const rm = flow.routing_model;

  it('every screen in the flow appears in the routing model', () => {
    const declared = flow.screens.filter((s) => !s.terminal).map((s) => s.id);
    const missing = declared.filter((id) => !(id in rm));
    expect(missing).toEqual([]);
  });

  it('every routing target is a screen that actually exists', () => {
    const ids = new Set(flow.screens.map((s) => s.id));
    const dangling = [];
    for (const [from, tos] of Object.entries(rm)) {
      for (const to of tos) if (!ids.has(to)) dangling.push(`${from} -> ${to}`);
    }
    expect(dangling).toEqual([]);
  });

  it('TEACHER_ACTION is wired between the school and both paths', () => {
    expect(rm.TEACHER_SCHOOL).toContain('TEACHER_ACTION');
    expect(rm.TEACHER_ACTION).toEqual(expect.arrayContaining(['TEACHER_ADD', 'TEACHER_PICK']));
  });

  it('the add screen no longer routes to the remove picker', () => {
    // The EmbeddedLink is gone, so the edge must go with it — a stale edge is
    // not rejected by Meta, it just quietly misdescribes the flow.
    expect(rm.TEACHER_ADD).not.toContain('TEACHER_PICK');
  });

  it('no screen is orphaned — everything is reachable from MENU', () => {
    const seen = new Set(['MENU']);
    const queue = ['MENU'];
    while (queue.length) {
      for (const to of rm[queue.shift()] || []) {
        if (!seen.has(to)) { seen.add(to); queue.push(to); }
      }
    }
    const orphans = flow.screens.map((s) => s.id).filter((id) => !seen.has(id));
    expect(orphans).toEqual([]);
  });
});
