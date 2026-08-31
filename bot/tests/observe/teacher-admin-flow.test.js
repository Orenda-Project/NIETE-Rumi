/**
 * The Flow half: the steps behind the teacher screens (TDD, red-first).
 *
 * The highest-value assertion here is the LAST describe block, and it exists
 * because of a live outage class in this exact flow: a screen DECLARES its data
 * keys, and a payload that omits one fails the screen with no visible error —
 * the coach taps and nothing opens. Removing a school was invisibly broken on
 * production for exactly that reason. So every screen these steps return is
 * checked against the keys the published JSON declares.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OBSERVE_SCHEDULING_UI = 'true';

const flow = require('../../../docs/flows/observe-visit-v2.json');

// The handler reaches for supabase and the schedule service on the way to any
// screen; with a localhost URL those become real fetches that time out one by
// one. Neutralise them — this suite is about the STEPS, not the data layer.
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
    { school_ext_id: 'niete:273', school_name: 'IMS(I-V) No.2 G-10/2', emis: '273' },
  ])),
}));

jest.mock('../../shared/services/observe/observe-teacher-admin.service', () => {
  const actual = jest.requireActual('../../shared/services/observe/observe-teacher-admin.service');
  return {
    ...actual,
    planAdd: jest.fn(async () => ({
      outcome: 'move',
      phone: '923001234567',
      person: { userId: 'u1', name: 'Tahira Manzoor', role: 'teacher', isPrincipal: false },
      fromSchoolExtId: 'niete:273',
      fromSchoolName: 'IMS(I-V) No.2 G-10/2',
      toSchoolName: 'IMCG, G-10/2',
      target: { school_ext_id: 'niete:916', school_id: 's916', school_name: 'IMCG, G-10/2' },
    })),
    commitAdd: jest.fn(async () => ({
      outcome: 'move', wrote: true, phone: '923001234567',
      person: { name: 'Tahira Manzoor', isPrincipal: false },
      fromSchoolName: 'IMS(I-V) No.2 G-10/2', toSchoolName: 'IMCG, G-10/2',
    })),
    commitRemoval: jest.fn(async () => ({
      ok: true, name: 'Tahira Manzoor', schoolName: 'IMCG, G-10/2', visitsCancelled: 1,
    })),
  };
});

// The remove picker reads the DERIVED patch, not a roster table.
jest.mock('../../shared/services/observe/patch-resolver.service', () => {
  const actual = jest.requireActual('../../shared/services/observe/patch-resolver.service');
  return {
    ...actual,
    listPatchViaSupabase: jest.fn(async () => ([
      { userId: 'u1', name: 'Tahira Manzoor', phone: '923001234567',
        isPrincipal: false, roleLabel: '', band: 'primary',
        schoolName: 'IMCG, G-10/2', emis: '916' },
    ])),
  };
});

const handler = require('../../shared/handlers/observe-visit-flow.handler');
const TeacherAdmin = require('../../shared/services/observe/observe-teacher-admin.service');

const UID = 'coach-a';
const step = (s, data = {}) => handler.handle(UID, 'data_exchange', '', { step: s, ...data }, UID, { id: UID });

describe('the coach can reach teacher admin from the menu', () => {
  it('the menu offers it as its own action, not buried in the school one', async () => {
    const res = await handler.menuScreen(UID);
    const item = (res.data.items || []).find((i) => String(i.id).includes('teacher'));
    expect(item).toBeTruthy();
    expect(item['on-click-action'].payload.step).toBe('teacher_school_open');
  });
});

describe('adding', () => {
  it('teacher_school_open lists her own schools to choose from', async () => {
    const res = await step('teacher_school_open');
    expect(res.screen).toBe('TEACHER_SCHOOL');
    expect(res.data.options.map((o) => o.id)).toContain('niete:916');
  });

  it('teacher_add_open composes the sentence server-side, school named in full', async () => {
    // The screen binds ${data.intro} as a whole value. It used to interpolate
    // ${data.school_name} mid-sentence, which Flow prints verbatim.
    const res = await step('teacher_add_open', { school_ext_id: 'niete:916' });
    expect(res.screen).toBe('TEACHER_ADD');
    expect(res.data.intro).toContain('IMCG, G-10/2');
    expect(res.data.intro).not.toContain('${');
    expect(res.data.school_ext_id).toBe('niete:916');
  });

  it('teacher_add_open asks for a number and nothing else', () => {
    const scr = flow.screens.find((x) => x.id === 'TEACHER_ADD');
    const inputs = JSON.stringify(scr).match(/"type":"TextInput"/g) || [];
    expect(inputs).toHaveLength(1);
    expect(JSON.stringify(scr)).toContain('"name":"phone"');
  });

  it('a KNOWN number goes straight to the account we found — no name asked', async () => {
    const res = await step('teacher_add_lookup', { school_ext_id: 'niete:916', phone: '03001234567' });
    expect(res.screen).toBe('TEACHER_CONFIRM');
    expect(res.data.found_heading).toMatch(/found/i);
    expect(res.data.found_details).toContain('Tahira Manzoor');
    expect(res.data.found_details).toContain('IMS(I-V) No.2 G-10/2');
    expect(TeacherAdmin.commitAdd).not.toHaveBeenCalled();
    expect(res.data).toMatchObject({ school_ext_id: 'niete:916', phone: '923001234567' });
  });

  it('an UNKNOWN number is the only case that asks for a name', async () => {
    TeacherAdmin.planAdd.mockResolvedValueOnce({ outcome: 'new', phone: '923273222269' });
    const res = await step('teacher_add_lookup', { school_ext_id: 'niete:916', phone: '3273222269' });
    expect(res.screen).toBe('TEACHER_NAME');
    expect(res.data.intro).toContain('923273222269');
    expect(res.data.intro).not.toContain('${');
  });

  it('the name screen hands back to confirm, still writing nothing', async () => {
    TeacherAdmin.planAdd.mockResolvedValueOnce({ outcome: 'new', phone: '923273222269' });
    const res = await step('teacher_add_named', {
      school_ext_id: 'niete:916', phone: '923273222269', name: 'Hataf Test Two',
    });
    expect(res.screen).toBe('TEACHER_CONFIRM');
    expect(res.data.found_details).toContain('Hataf Test Two');
    expect(TeacherAdmin.commitAdd).not.toHaveBeenCalled();
  });

  it('a bad number ends the flow with a reason, never a crash', async () => {
    TeacherAdmin.planAdd.mockResolvedValueOnce({ outcome: 'invalid_phone' });
    const res = await step('teacher_add_lookup', { school_ext_id: 'niete:916', phone: '12345' });
    expect(res.screen).toBe('TEACHER_DONE');
    expect(res.data.body).toMatch(/number/i);
  });

  it('an ambiguous number refuses and says why', async () => {
    // The old 'ambiguous' case is gone: users.phone_number is UNIQUE, so one
    // number is one person. Filing a coach as a teacher is the refusal that
    // replaced it.
    TeacherAdmin.planAdd.mockResolvedValueOnce({ outcome: 'is_coach', phone: '923001234567' });
    const res = await step('teacher_add_lookup', { school_ext_id: 'niete:916', phone: '03001234567' });
    expect(res.screen).toBe('TEACHER_DONE');
    expect(res.data.body).toMatch(/coach/i);
  });

  it('teacher_add_commit is what actually writes', async () => {
    const res = await step('teacher_add_commit', {
      school_ext_id: 'niete:916', phone: '923001234567', name: 'Tahira Manzoor',
    });
    expect(TeacherAdmin.commitAdd).toHaveBeenCalled();
    expect(res.screen).toBe('TEACHER_DONE');
    expect(res.data.body).toContain('Tahira Manzoor');
  });
});

describe('removing', () => {
  it('teacher_remove_open lists her teachers at that school', async () => {
    const res = await step('teacher_remove_open', { school_ext_id: 'niete:916' });
    expect(res.screen).toBe('TEACHER_PICK');
    // Keyed on the user id: removal clears users.school_id, so the id is what
    // the commit needs, not the phone.
    expect(res.data.options[0].id).toBe('u1');
    expect(res.data.school_ext_id).toBe('niete:916');
  });

  it('teacher_remove_check warns about the visits it will cancel', async () => {
    const res = await step('teacher_remove_check', {
      school_ext_id: 'niete:916', teacher_ext_id: 'u1',
    });
    expect(res.screen).toBe('TEACHER_REMOVE_CONFIRM');
    expect(res.data.plan).toContain('Tahira Manzoor');
    expect(res.data.teacher_ext_id).toBe('u1');
    expect(TeacherAdmin.commitRemoval).not.toHaveBeenCalled();
  });

  it('teacher_remove_commit writes and reports what happened', async () => {
    const res = await step('teacher_remove_commit', {
      school_ext_id: 'niete:916', teacher_ext_id: 'u1', reason: 'left',
    });
    expect(TeacherAdmin.commitRemoval).toHaveBeenCalled();
    expect(res.screen).toBe('TEACHER_DONE');
  });

  it('teacher_cancel backs out without writing', async () => {
    const res = await step('teacher_cancel');
    expect(res.screen).toBe('TEACHER_DONE');
    expect(TeacherAdmin.commitAdd).not.toHaveBeenCalled();
    expect(TeacherAdmin.commitRemoval).not.toHaveBeenCalled();
  });
});

// ── the outage class this flow already suffered ────────────────────────

describe('every screen these steps return satisfies the keys it declares', () => {
  const declared = (sid) => {
    const s = flow.screens.find((x) => x.id === sid);
    return Object.keys((s && s.data) || {});
  };

  const CASES = [
    ['teacher_school_open', {}],
    ['teacher_add_open', { school_ext_id: 'niete:916' }],
    ['teacher_add_lookup', { school_ext_id: 'niete:916', phone: '03001234567' }],
    ['teacher_add_named', { school_ext_id: 'niete:916', phone: '923001234567', name: 'X' }],
    ['teacher_add_commit', { school_ext_id: 'niete:916', phone: '923001234567', name: 'T' }],
    ['teacher_remove_open', { school_ext_id: 'niete:916' }],
    ['teacher_remove_check', { school_ext_id: 'niete:916', teacher_ext_id: 'u1' }],
    ['teacher_remove_commit', { school_ext_id: 'niete:916', teacher_ext_id: 'u1' }],
    ['teacher_cancel', {}],
  ];

  it.each(CASES)('%s returns every key its screen declares', async (s, data) => {
    const res = await step(s, data);
    const missing = declared(res.screen).filter((k) => !(k in (res.data || {})));
    expect({ screen: res.screen, missing }).toEqual({ screen: res.screen, missing: [] });
  });
});

// ── the loop back, which a terminal screen cannot do on its own ────────

describe('the "what next?" tap after a teacher change', () => {
  const { rosterTeacherNextTarget } = require('../../shared/services/observe/observe-teacher-admin.service');

  it('reopens rather than falling through to the capture prompt', () => {
    // The visit action this screen emits must have its OWN branch. An
    // unhandled action falls through to buildVisitCapturePrompt, which
    // answers a roster tap with "tell me about the lesson you observed".
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../shared/handlers/flow-response.handler.js'), 'utf8');
    expect(src).toMatch(/visitAction === 'roster_teacher'/);
  });

  it('every option the screen offers has a target', () => {
    const screen = flow.screens.find((s) => s.id === 'TEACHER_DONE');
    const radio = screen.layout.children
      .find((c) => c.type === 'Form').children
      .find((c) => c.type === 'RadioButtonsGroup');
    for (const opt of radio['data-source']) {
      expect(rosterTeacherNextTarget(opt.id)).toBeTruthy();
    }
  });

  it('looping back goes through the endpoint, never a bare navigate', () => {
    // TEACHER_SCHOOL and TEACHER_PICK DECLARE `options`, and navigate mode has
    // no endpoint round trip to fill them — the screen would fail silently.
    // So a loop reopens at MENU in data_exchange mode: one extra tap, always live.
    for (const id of ['teacher_add', 'teacher_remove']) {
      const t = rosterTeacherNextTarget(id);
      expect(t.reopen).toBe(true);
      expect(t.screen).toBeNull();
    }
  });

  it('"I\'m done" closes instead of reopening', () => {
    expect(rosterTeacherNextTarget('done')).toMatchObject({ reopen: false });
    expect(rosterTeacherNextTarget('anything-stale')).toMatchObject({ reopen: false });
  });
});

// ── bd-59809 / bd-59811 — Waheed's field feedback ──────────────────────
// Folded into THIS suite rather than a separate file: two suites mocking the
// same modules in one jest worker race each other's registries, and the loser
// gets the real supabase client. One suite, one set of mocks.
const flowScreen = (id) => flow.screens.find((s) => s.id === id);

// ── 1. full names in the picker ────────────────────────────────────────

describe('Waheed 1 — the picker names the whole teacher', () => {
  it('two Muhammads are told apart by their full names, not just "Muhammad"', async () => {
    // The suite's shared patch mock returns one person; override it here to the
    // shape Waheed actually hit — a school where several names start the same.
    const P = require('../../shared/services/observe/patch-resolver.service');
    P.listPatchViaSupabase.mockResolvedValueOnce([
      { userId: 'u1', name: 'Muhammad Kashif Rafique', phone: '923001234567',
        isPrincipal: false, roleLabel: '', band: 'primary', schoolName: 'IMCG, G-10/2', emis: '916' },
      { userId: 'u2', name: 'Muhammad Farooq Bashir', phone: '923001234568',
        isPrincipal: false, roleLabel: '', band: 'primary', schoolName: 'IMCG, G-10/2', emis: '916' },
    ]);
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
    const scr = flowScreen('TEACHER_SCHOOL');
    const footer = JSON.stringify(scr).match(/"type":"Footer","label":"([^"]+)"/)[1];
    expect(footer).toBe('Continue');
  });

  it('the school screen leads to the CHOICE, not straight into add', () => {
    const scr = flowScreen('TEACHER_SCHOOL');
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
    const scr = flowScreen('TEACHER_ACTION');
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
    const res = await step('teacher_action_pick', { school_ext_id: 'niete:916', choice: 'add' });
    expect(res.screen).toBe('TEACHER_ADD');
    expect(res.data.school_ext_id).toBe('niete:916');
  });

  it('choosing Remove lands on the teacher dropdown', async () => {
    const res = await step('teacher_action_pick', { school_ext_id: 'niete:916', choice: 'remove' });
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
    const scr = JSON.stringify(flowScreen('TEACHER_ADD'));
    expect(scr).not.toContain('Remove a teacher from this school');
    expect(scr).not.toContain('teacher_remove_open');
  });

  it('still asks for a number and nothing else', () => {
    const scr = flowScreen('TEACHER_ADD');
    const inputs = JSON.stringify(scr).match(/"type":"TextInput"/g) || [];
    expect(inputs).toHaveLength(1);
    expect(JSON.stringify(scr)).toContain('"name":"phone"');
  });
});

// ── the outage class: a screen whose declared keys go unfilled ──────────

describe('every new step fills the keys its screen declares', () => {
  const declared = (sid) => Object.keys((flowScreen(sid) || {}).data || {});
  const CASES = [
    ['teacher_action_open', { school_ext_id: 'niete:916' }],
    ['teacher_action_pick', { school_ext_id: 'niete:916', choice: 'add' }],
    ['teacher_action_pick', { school_ext_id: 'niete:916', choice: 'remove' }],
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

// ── bd-59811 — the payload key that took the flow down ─────────────────
//
// Reported from the field within the hour: "I select any school then click add
// or click remove, it says 'they are not at that school so there is nothing to
// move'. It never asked me a teacher whatsapp number."
//
// The screen sent its choice as payload key `action`. That is the RESERVED name
// for the Flow request type — the endpoint destructures
// `const { action, flow_token, screen, data } = decryptedData`, and
// `action` is 'INIT' | 'BACK' | 'data_exchange'. Staging logs show the fork
// being reached with the envelope's value, never the coach's:
//
//   screen="TEACHER_ACTION" step="teacher_action_pick" action="data_exchange"
//
// so `picked` was '' and every tap fell to _refuse('not_found').
//
// My original test passed `action:'add'` straight into the handler, which the
// envelope never does — it asserted a payload shape the Flow cannot produce.
// The convention this flow already had is `choice` (VISIT_ACTION), which works
// in production. These tests pin the KEY, not just the behaviour.

describe('bd-59811 — the choice must not ride on a reserved key', () => {
  it('the screen sends `choice`, never `action`', () => {
    const scr = flowScreen('TEACHER_ACTION');
    const payload = JSON.parse(JSON.stringify(scr)).layout.children
      .find((c) => c.type === 'Form').children
      .find((c) => c.type === 'Footer')['on-click-action'].payload;
    expect(payload.choice).toBe('${form.choice}');
    expect(payload).not.toHaveProperty('action');
  });

  it('the radio is named `choice` so ${form.choice} resolves', () => {
    const radio = flowScreen('TEACHER_ACTION').layout.children
      .find((c) => c.type === 'Form').children
      .find((c) => c.type === 'RadioButtonsGroup');
    expect(radio.name).toBe('choice');
  });

  it('NO screen in this flow sends a payload key called `action`', () => {
    // Generalised past this bead: the reserved word is reserved everywhere.
    const offenders = [];
    const walk = (node, sid) => {
      if (Array.isArray(node)) return node.forEach((n) => walk(n, sid));
      if (!node || typeof node !== 'object') return;
      if (node.name === 'data_exchange' && node.payload && 'action' in node.payload) offenders.push(sid);
      Object.values(node).forEach((v) => walk(v, sid));
    };
    flow.screens.forEach((s) => walk(s, s.id));
    expect(offenders).toEqual([]);
  });

  it('a tap with the real payload reaches the add path, not a refusal', async () => {
    const res = await step('teacher_action_pick', { school_ext_id: 'niete:916', choice: 'add' });
    expect(res.screen).toBe('TEACHER_ADD');
  });

  it('the envelope action leaking in is NOT read as the coach\'s choice', async () => {
    // What actually happened on staging: the only `action` present was the
    // request type. That must refuse, not silently pick a branch.
    const res = await step('teacher_action_pick', { school_ext_id: 'niete:916', action: 'data_exchange' });
    expect(res.screen).toBe('TEACHER_DONE');
  });
});

describe('bd-59811 — Back out of TEACHER_ACTION', () => {
  // Staging logged: "Can't perform a transition from [TEACHER_ACTION] to
  // [MENU], because it doesn't satisfy provided routing_model".
  //
  // The tempting fix — add a MENU edge — is WRONG and three existing suites
  // already say so: routing must be a DAG (bd-ve7kd, bd-gndeg, bd-jrxo3), and
  // MENU -> TEACHER_SCHOOL -> TEACHER_ACTION -> MENU is a cycle that fails
  // publish outright. NO screen in this flow routes back to MENU; Back is the
  // handler's `action === 'BACK'` branch, which already falls through to
  // menuScreen(). So the invariant to hold is the DAG, and TEACHER_ACTION
  // having the same shape as the sibling screens that work.

  it('adds no cycle — the routing model stays a DAG', () => {
    const rm = flow.routing_model;
    const seen = {};
    const walk = (n, stack) => {
      if (stack.includes(n)) throw new Error(`cycle: ${stack.join(' -> ')} -> ${n}`);
      if (seen[n]) return;
      seen[n] = 1;
      for (const next of rm[n] || []) walk(next, [...stack, n]);
    };
    expect(() => Object.keys(rm).forEach((n) => walk(n, []))).not.toThrow();
  });

  it('routes back to MENU no more than its working siblings do', () => {
    // TEACHER_SCHOOL is reached from MENU and works today. Match it.
    const rm = flow.routing_model;
    expect(rm.TEACHER_ACTION).not.toContain('MENU');
    expect(rm.TEACHER_SCHOOL).not.toContain('MENU');
  });

  it('the BACK branch still answers with the menu, server-side', async () => {
    const res = await handler.handle(UID, 'BACK', 'TEACHER_ACTION', {}, UID, { id: UID });
    expect(res.screen).toBe('MENU');
  });
});
