/**
 * /observe2: what the coach typed in the live form comes back to them (pilot sheet R13, 14 Oct).
 *
 * Prod, 6 to 15 Oct: 28 parts were saved twice. 13 forms went Part 1, Part 1 again, Part 2: the coach
 * came back to Part 1, and each "Part 1 done" got a fresh, empty Part 2 from the endpoint. One form
 * (15 Oct) re-sent Part 1 after Part 2 was saved and had to fill Part 2 in again. A reopened form
 * says "Part 1 is saved" and goes on, and nothing the coach typed is shown again.
 *
 * Now:
 *   - Part 2 comes back with what was saved for it (Form init-values). Only for a form opened on the
 *     new Flow: its footers send a marker, and a form opened on today's Flow keeps today's answers.
 *   - A reopened form lists the notes already typed, by part (CONTINUE's text: every form, old or new).
 *
 * Real: the endpoint, the store and the rules over an in-memory database. Mocked: WhatsApp, R2.
 */
const { createFakeSupabase } = require('./helpers/fake-supabase');

let mockFake;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendFlow: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn((buf, key) => Promise.resolve(`https://r2.example/${key}`)) }));
jest.mock('../../bot/shared/services/observe/observe-debrief.service', () => ({ displayTimeZone: () => 'Asia/Karachi' }));

const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const Endpoint = require('../../bot/shared/routes/observe2-form-endpoint');
const { buildFieldFormFlow, FORM_VERSION, PREFILL, PREFILLED, PREFILLED_ARRAYS } = require('../../bot/shared/services/observe/observe2/field-form.flow');

const token = (formId) => `coach-1:observe2-form:${formId}`;
const row = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);

async function newForm(patch = {}) {
  const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: {} });
  Object.assign(row(form.id), { period_minutes: 40 }, patch);
  return form.id;
}

// The parts as a form on the current Flow posts them (form version 5: Part 2 is the children working alone).
const PART_1 = {
  screen: 'PART_ONE', fv: FORM_VERSION, present: '32', p1_spoke: '6', p1_picked: 'once', p1_groups: 'alone', p1_listen: ['turns'],
  p1_listen_other: 'one child did the chart', p1_materials: 'children', p1_used: ['book'], p1_change: 'yes', p1_change_how: 'slow',
  p1_notes: '8 min: board wiped',
};
const PART_2 = {
  screen: 'PART_TWO', fv: FORM_VERSION, p2_spoke: '10', p2_new: '5', p2_task: 'all', p2_teacher: ['round'], p2_stuck: 'unsure',
  p2_think: ['why', 'new'], p2_change: 'no', p2_notes: '27 min: three at the back had no task',
};
// The parts as a form opened before form version 5 posts them: no fv, the same questions in both parts.
const OLD_PART_1 = {
  screen: 'PART_ONE', present: '32', p1_spoke: '6', p1_picked: 'once', p1_groups: 'alone', p1_listen: ['turns'],
  p1_listen_other: '', p1_materials: 'teacher', p1_change: 'yes', p1_change_how: 'slow', p1_notes: '8 min: board wiped',
};
const OLD_PART_2 = {
  screen: 'PART_TWO', p2_spoke: '10', p2_new: '5', p2_picked: 'often', p2_groups: 'combine', p2_listen: ['once'],
  p2_listen_other: '', p2_materials: 'children', p2_change: 'no', p2_notes: '',
};
const NEW = { prefill: PREFILL };
const initKeys = (data) => Object.keys(data).filter((k) => k.startsWith('init_')).sort();

beforeEach(() => {
  jest.clearAllMocks();
  mockFake = createFakeSupabase({
    users: [
      { id: 'coach-1', phone_number: '923000000001', name: 'Coach', preferred_language: 'en', role: 'coach' },
      { id: 'teacher-1', phone_number: '923000000002', name: 'Rabia', preferred_language: 'en', role: 'teacher' },
    ],
  });
});

describe('Part 2 comes back with what was saved for it', () => {
  test('back to Part 1 after Part 2 was saved: "Part 1 done" again opens Part 2 filled in', async () => {
    const id = await newForm();
    await Endpoint.handleObserve2FormDataExchange(token(id), 'PART_ONE', { ...PART_1, ...NEW });
    await Endpoint.handleObserve2FormDataExchange(token(id), 'PART_TWO', { ...PART_2, ...NEW });
    const out = await Endpoint.handleObserve2FormDataExchange(token(id), 'PART_ONE', { ...PART_1, ...NEW });
    expect(out.screen).toBe('PART_TWO');
    expect(out.data).toMatchObject({
      init_p2_spoke: '10', init_p2_new: '5', init_p2_task: 'all', init_p2_think: ['why', 'new'],
      init_p2_change: 'no', init_p2_notes: PART_2.p2_notes,
    });
    expect(initKeys(out.data)).toEqual(PREFILLED.PART_TWO.map((f) => `init_${f}`).sort());
  });

  test('a first Part 2 is empty, as strings (Meta refuses null)', async () => {
    const id = await newForm();
    const out = await Endpoint.handleObserve2FormDataExchange(token(id), 'PART_ONE', { ...PART_1, ...NEW });
    expect(out.screen).toBe('PART_TWO');
    for (const f of PREFILLED.PART_TWO) expect(out.data[`init_${f}`]).toEqual(PREFILLED_ARRAYS.has(f) ? [] : '');
  });

  test('Part 2 refused under a field keeps what the coach just typed', async () => {
    const id = await newForm();
    await Endpoint.handleObserve2FormDataExchange(token(id), 'PART_ONE', { ...PART_1, ...NEW });
    const bad = { ...PART_2, p2_new: '30', ...NEW };
    const out = await Endpoint.handleObserve2FormDataExchange(token(id), 'PART_TWO', bad);
    expect(out.screen).toBe('PART_TWO');
    expect(out.data.has_error).toBe(true);
    expect(out.data).toMatchObject({ init_p2_new: '30', init_p2_notes: PART_2.p2_notes, init_p2_task: 'all', init_p2_think: ['why', 'new'] });
  });

  test('a reopened form continued to Part 2 opens it with the new Flow\'s fields', async () => {
    const id = await newForm();
    await Endpoint.handleObserve2FormDataExchange(token(id), 'PART_ONE', { ...PART_1, ...NEW });
    const out = await Endpoint.handleObserve2FormDataExchange(token(id), 'CONTINUE', { screen: 'CONTINUE', fv: FORM_VERSION, ...NEW });
    expect(out.screen).toBe('PART_TWO');
    expect(initKeys(out.data)).toEqual(PREFILLED.PART_TWO.map((f) => `init_${f}`).sort());
  });

  test("a form opened on today's Flow (no marker) gets today's answers, unchanged", async () => {
    const id = await newForm();
    await Endpoint.handleObserve2FormDataExchange(token(id), 'PART_ONE', OLD_PART_1);
    await Endpoint.handleObserve2FormDataExchange(token(id), 'PART_TWO', OLD_PART_2);
    const again = await Endpoint.handleObserve2FormDataExchange(token(id), 'PART_ONE', OLD_PART_1);
    expect(again.screen).toBe('PART_TWO');
    expect(initKeys(again.data)).toEqual([]);
    const cont = await Endpoint.handleObserve2FormDataExchange(token(await newForm({ part1_done_at: 'x' })), 'CONTINUE', { screen: 'CONTINUE', fv: '4' });
    expect(initKeys(cont.data)).toEqual([]);
  });
});

describe('a reopened form shows the notes already typed', () => {
  test('after Part 1: "Part 1 is saved" and the Part 1 notes', async () => {
    const id = await newForm();
    await Endpoint.handleObserve2FormDataExchange(token(id), 'PART_ONE', PART_1);
    const out = await Endpoint.handleObserve2FormInit(token(id));
    expect(out.screen).toBe('CONTINUE');
    expect(out.data.continue_heading).toBe('Part 1 is saved');
    expect(out.data.continue_line).toMatch(/Part 2/);
    expect(out.data.continue_line).toContain('8 min: board wiped');
    expect(out.data.continue_line).toContain('one child did the chart');
  });

  test('after the seal: every note, by part', async () => {
    const id = await newForm({
      part1_done_at: 'x', part2_done_at: 'x', sealed_at: '2026-09-30T05:39:00.000Z',
      answers: { p1_notes: '8 min: board wiped', p2_notes: '27 min: no task at the back', note: 'Back rows could not see', detail: '31 min: shouted at a child', incident: 'ridicule' },
    });
    const out = await Endpoint.handleObserve2FormInit(token(id));
    const line = out.data.continue_line;
    for (const t of ['Part 1', '8 min: board wiped', 'Part 2', '27 min: no task at the back', 'Not in the recording', 'Back rows could not see', '31 min: shouted at a child']) expect(line).toContain(t);
    expect(line.indexOf('8 min: board wiped')).toBeLessThan(line.indexOf('27 min: no task at the back'));
  });

  test('no notes: the line is as before', async () => {
    const id = await newForm({ part1_done_at: '2026-09-30T05:20:00.000Z', answers: { present: '30' } });
    const out = await Endpoint.handleObserve2FormInit(token(id));
    expect(out.data.continue_line).toMatch(/^Carry on with Part 2/);
    expect(out.data.continue_line).not.toContain('Your notes');
    expect(out.data.continue_line).not.toContain('\n');
  });
});

describe('the Flow: Part 2 is pre-filled, safely', () => {
  const flow = buildFieldFormFlow();
  const screen = (id) => flow.screens.find((s) => s.id === id);
  const formOf = (s) => s.layout.children.find((c) => c.type === 'Form');
  const named = (list, nested = false, out = []) => {
    for (const c of list || []) {
      if (c.name) out.push({ name: c.name, nested, type: c.type });
      for (const k of ['then', 'else', 'children']) if (Array.isArray(c[k])) named(c[k], nested || c.type === 'If' || c.type === 'Switch', out);
    }
    return out;
  };

  test("Part 2's init-values are its top-level fields, each from its own declared value of the field's type", () => {
    const s = screen('PART_TWO');
    const form = formOf(s);
    const top = named(form.children).filter((c) => !c.nested && c.type !== 'Footer');
    const names = top.map((c) => c.name).sort();
    expect(Object.keys(form['init-values'] || {}).sort()).toEqual(names);
    expect([...PREFILLED.PART_TWO].sort()).toEqual(names);
    for (const c of top) {
      expect(form['init-values'][c.name]).toBe(`\${data.init_${c.name}}`);
      // Meta: the init value's type must be the component's (a CheckboxGroup takes an array).
      expect(s.data[`init_${c.name}`]).toMatchObject({ type: c.type === 'CheckboxGroup' ? 'array' : 'string' });
    }
  });

  test('nothing inside an If is pre-filled (Meta documents no rule for it; no Flow here does it)', () => {
    for (const s of flow.screens) {
      const form = formOf(s);
      if (!form || !form['init-values']) continue;
      const nested = named(form.children).filter((c) => c.nested).map((c) => c.name);
      expect(Object.keys(form['init-values']).filter((k) => nested.includes(k))).toEqual([]);
    }
  });

  test('only the screens that lead to Part 2 send the marker', () => {
    const footers = {};
    for (const s of flow.screens) {
      const stack = [...s.layout.children];
      while (stack.length) {
        const c = stack.pop();
        if (c.type === 'Footer') footers[s.id] = c['on-click-action'].payload || {};
        for (const k of ['then', 'else', 'children']) if (Array.isArray(c[k])) stack.push(...c[k]);
      }
    }
    const marked = Object.entries(footers).filter(([, p]) => p.prefill === PREFILL).map(([id]) => id).sort();
    expect(marked).toEqual(['CONTINUE', 'PART_ONE', 'PART_TWO']);
  });
});
