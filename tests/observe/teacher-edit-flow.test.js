/**
 * The Edit-teacher Flow wiring: screens, routing, and the payload contract.
 *
 * These are structural assertions against the Flow JSON, because the JSON is a
 * Meta-published artifact — a screen that references a step the handler does not
 * implement is a dead end a coach discovers in the field, not a test failure.
 *
 * The payload-key check is the one that has already cost us: a key literally
 * named `data` collides with the decrypt destructure
 * (`const { action, flow_token, screen, data } = decryptedData`) and arrives as
 * 'data_exchange' rather than the coach's pick. That shipped once and made every
 * tap on TEACHER_ACTION fall through to "there is nothing to remove".
 */

const fs = require('fs');
const path = require('path');

const FLOW = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../../docs/flows/observe-visit-v2.json'), 'utf8'));
const HANDLER = fs.readFileSync(
  path.join(__dirname, '../../bot/shared/handlers/observe-visit-flow.handler.js'), 'utf8');

const screen = (id) => FLOW.screens.find((s) => s.id === id);
const EDIT_SCREENS = [
  'TEACHER_EDIT_PICK', 'TEACHER_EDIT_FIELD', 'TEACHER_EDIT_NAME',
  'TEACHER_EDIT_LEVEL', 'TEACHER_EDIT_PHONE', 'TEACHER_EDIT_PHONE_CONFIRM',
];

describe('the Edit option on the action menu', () => {
  it('is offered alongside add and remove', () => {
    const radio = screen('TEACHER_ACTION').layout.children
      .find((c) => c.type === 'Form').children
      .find((c) => c.type === 'RadioButtonsGroup');
    expect(radio['data-source'].map((o) => o.id)).toEqual(['add', 'remove', 'edit']);
  });

  it('routes to the edit picker', () => {
    expect(FLOW.routing_model.TEACHER_ACTION).toContain('TEACHER_EDIT_PICK');
  });
});

describe('every edit screen exists and is reachable', () => {
  it.each(EDIT_SCREENS)('%s is defined', (id) => {
    expect(screen(id)).toBeTruthy();
  });

  it('every routing target resolves to a real screen', () => {
    const ids = new Set(FLOW.screens.map((s) => s.id));
    const dangling = Object.entries(FLOW.routing_model)
      .flatMap(([, targets]) => targets)
      .filter((t) => !ids.has(t));
    expect(dangling).toEqual([]);
  });

  it('each edit screen can reach TEACHER_DONE, so no path traps the coach', () => {
    for (const id of EDIT_SCREENS) {
      expect(FLOW.routing_model[id]).toContain('TEACHER_DONE');
    }
  });
});

describe('the payload contract', () => {
  const payloads = JSON.stringify(FLOW).match(/"payload":\{[^}]*\}/g) || [];

  it('no payload key is literally named `data` — it collides with the decrypt', () => {
    const offenders = payloads.filter((p) => /"data"\s*:/.test(p));
    expect(offenders).toEqual([]);
  });

  it('every edit step the Flow calls is implemented in the handler', () => {
    const steps = [...new Set(
      (JSON.stringify(FLOW).match(/"step":"(teacher_edit[a-z_]*)"/g) || [])
        .map((m) => m.split('"')[3]),
    )];
    // Guards against a screen shipping ahead of its handler branch.
    expect(steps.length).toBeGreaterThan(0);
    const missing = steps.filter((s) => !HANDLER.includes(`step === '${s}'`));
    expect(missing).toEqual([]);
  });

  it('the level screen carries the school and teacher through to its commit', () => {
    const footer = screen('TEACHER_EDIT_LEVEL').layout.children
      .find((c) => c.type === 'Form').children
      .find((c) => c.type === 'Footer');
    expect(footer['on-click-action'].payload).toMatchObject({
      step: 'teacher_edit_level_commit',
      school_ext_id: '${data.school_ext_id}',
      teacher_ext_id: '${data.teacher_ext_id}',
    });
  });
});

describe('the level screen lets a teacher hold more than one band', () => {
  it('uses a multi-select, not a single-choice control', () => {
    // A teacher teaching MIDDLE and HIGH must be able to say so; a radio group
    // here would silently halve her.
    const form = screen('TEACHER_EDIT_LEVEL').layout.children.find((c) => c.type === 'Form');
    const control = form.children.find((c) => c.name === 'bands');
    expect(control.type).toBe('CheckboxGroup');
  });
});

describe('the phone change is confirmed before it writes', () => {
  it('checks the number on its own screen before offering to move anyone', () => {
    const footer = screen('TEACHER_EDIT_PHONE').layout.children
      .find((c) => c.type === 'Form').children
      .find((c) => c.type === 'Footer');
    expect(footer['on-click-action'].payload.step).toBe('teacher_edit_phone_check');
  });

  it('only the confirm screen commits', () => {
    const footer = screen('TEACHER_EDIT_PHONE_CONFIRM').layout.children
      .find((c) => c.type === 'Form').children
      .find((c) => c.type === 'Footer');
    expect(footer['on-click-action'].payload.step).toBe('teacher_edit_phone_commit');
  });

  it('the commit RE-CLASSIFIES rather than trusting the confirm screen', () => {
    // The confirm is a separate round trip; a destination can acquire history
    // between the two taps, and a stale verdict is how two teachers get fused.
    const commit = HANDLER.slice(HANDLER.indexOf("step === 'teacher_edit_phone_commit'"));
    const body = commit.slice(0, commit.indexOf("\n    if (step ==="));
    expect(body).toMatch(/_loadTargetWithHistory/);
    expect(body).toMatch(/classifyTarget/);
  });
});

describe('the role screen — Teacher vs Principal (bd-60112)', () => {
  it('is offered on the field picker', () => {
    const radio = screen('TEACHER_EDIT_FIELD').layout.children
      .find((c) => c.type === 'Form').children
      .find((c) => c.name === 'field');
    expect(radio['data-source'].map((o) => o.id)).toContain('role');
  });

  it('exists, is routed to, and can reach TEACHER_DONE', () => {
    expect(screen('TEACHER_EDIT_ROLE')).toBeTruthy();
    expect(FLOW.routing_model.TEACHER_EDIT_FIELD).toContain('TEACHER_EDIT_ROLE');
    expect(FLOW.routing_model.TEACHER_EDIT_ROLE).toContain('TEACHER_DONE');
  });

  it('is single-choice — a person holds ONE role, unlike bands', () => {
    // The mirror of the TEACHER_EDIT_LEVEL assertion above: a CheckboxGroup
    // here would let a coach submit both and leave the write to guess.
    const control = screen('TEACHER_EDIT_ROLE').layout.children
      .find((c) => c.type === 'Form').children
      .find((c) => c.name === 'role');
    expect(control.type).toBe('RadioButtonsGroup');
  });

  it('carries the school and teacher through to its commit', () => {
    const footer = screen('TEACHER_EDIT_ROLE').layout.children
      .find((c) => c.type === 'Form').children
      .find((c) => c.type === 'Footer');
    expect(footer['on-click-action'].payload).toMatchObject({
      step: 'teacher_edit_role_commit',
      school_ext_id: '${data.school_ext_id}',
      teacher_ext_id: '${data.teacher_ext_id}',
      role: '${form.role}',
    });
  });

  it('offers the two roles from the SERVER, never hardcoded in the Flow', () => {
    // The screen must show which role the person currently holds, and only the
    // endpoint knows that. A static data-source would render a picker that
    // cannot say "is recorded as a Principal".
    const control = screen('TEACHER_EDIT_ROLE').layout.children
      .find((c) => c.type === 'Form').children
      .find((c) => c.name === 'role');
    expect(control['data-source']).toBe('${data.options}');
  });

  it('the commit RE-RESOLVES the person rather than trusting the payload', () => {
    // Same rule the name/level/phone commits follow: the pick and the save are
    // separate round trips and the roster can move between them.
    const commit = HANDLER.slice(HANDLER.indexOf("step === 'teacher_edit_role_commit'"));
    const body = commit.slice(0, commit.indexOf('\n    if (step ==='));
    expect(body).toMatch(/_editPerson\(/);
    expect(body).toMatch(/planRoleEdit/);
  });

  it('records the role it moved AWAY from, because this changes what they may do', () => {
    // `principal` carries observe:true in role-features.js, so this write grants
    // the right to observe other teachers. Without `from`, an unpick cannot know
    // what to restore.
    const commit = HANDLER.slice(HANDLER.indexOf("step === 'teacher_edit_role_commit'"));
    const body = commit.slice(0, commit.indexOf('\n    if (step ==='));
    expect(body).toMatch(/edit_role/);
    expect(body).toMatch(/from:/);
  });

  it('reads users.role on the row it edits', () => {
    // _editPerson selects an explicit column list; role must be in it or the
    // plan compares against undefined and every save looks like a change.
    expect(HANDLER).toMatch(/\.select\('id, name, phone_number, role,/);
  });
});
