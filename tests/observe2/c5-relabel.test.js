/**
 * /observe2 — the field form's switch question in v6 minutes (FICO17 v6, spec §7.5; CONTRACTS §6.4; RULINGS R6).
 *
 * "How did the switch go?" (${p}_change_how, both parts) takes its options from the endpoint, per visit: a v5 visit
 * gets today's titles (PLAIN.C5) and descriptions, word for word; a v6 visit the §7.5 minutes. The ids never change
 * (stalled, slow, clear, ahead: rules.SWITCH, slowest first), so a form sealed under either keeps scoring as before.
 * The Flow is form version 7; the v5 snapshot differs from it only in that data-source and the version on the footers.
 *
 * Real: endpoint, store, Flow builder. Mocked: the database (in-memory), WhatsApp, the debrief's time zone.
 */
const { createFakeSupabase } = require('./helpers/fake-supabase');

let mockFake;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendFlow: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/observe/observe-debrief.service', () => ({ displayTimeZone: () => 'Asia/Karachi' }));

const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const Endpoint = require('../../bot/shared/routes/observe2-form-endpoint');
const Switch = require('../../bot/shared/services/coaching/fico-rubric-switch');
const V6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const { buildFieldFormFlow, FORM_VERSION } = require('../../bot/shared/services/observe/observe2/field-form.flow');
const { PLAIN } = require('../../bot/shared/services/observe/observe2/fico17');
const { SWITCH } = require('../../bot/shared/services/observe/observe2/rules');
const V5_FORM = require('./fixtures/field-form-v5.json');

const token = (formId, userId = 'coach-1') => `${userId}:observe2-form:${formId}`;
const row = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);
const setSwitch = (value) => {
  mockFake.__tables.app_settings = value == null ? [] : [{ key: 'fico_coach_rubric', value }];
  Switch._resetCache();
};
async function newForm(patch = {}) {
  const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: {} });
  Object.assign(row(form.id), { period_minutes: 40 }, patch);
  return form.id;
}

const IDS = ['stalled', 'slow', 'clear', 'ahead'];
const V6_TITLES = ['Over 3 min, no clear signal', '2-3 min after the signal', 'Under 2 min after the signal', 'Moved without being told'];
// Today's descriptions, word for word (field-form.flow.js SWITCHED before form version 7).
const V5_DESCRIPTIONS = [
  "The teacher didn't clearly say it was time to change. Children kept chatting or wandering, and the lesson stopped.",
  'The teacher said it was time to change, but many children took more than a minute or had to be called back.',
  'The teacher said it was time to change, and nearly every child was on the new task within about a minute.',
  'The children already knew the routine and moved to the next task on their own, without being told one by one.',
];
const PART_1_OK = {
  screen: 'PART_ONE', fv: '7', present: '32', p1_spoke: '6', p1_picked: 'once', p1_groups: 'alone', p1_listen: ['turns'],
  p1_listen_other: '', p1_materials: 'teacher', p1_used: ['book'], p1_change: 'yes', p1_change_how: 'slow', p1_notes: '',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFake = createFakeSupabase({
    users: [
      { id: 'coach-1', phone_number: '923000000001', name: 'Coach', preferred_language: 'en', role: 'coach', region: 'Sihala' },
      { id: 'teacher-1', phone_number: '923000000002', name: 'Rabia', preferred_language: 'en', role: 'teacher', teacher_level: ['PRIMARY'] },  // bd-ra8xu.42: v6 reaches grades 1-5 visits only
    ],
  });
  Switch._resetCache();
});

describe('the Flow (form version 7)', () => {
  const flow = buildFieldFormFlow();
  const screens = Object.fromEntries(flow.screens.map((s) => [s.id, s]));
  const find = (s, name) => {
    let hit = null;
    const walk = (list) => (list || []).forEach((c) => { if (c.name === name) hit = c; walk(c.children); walk(c.then); walk(c.else); });
    walk(s.layout.children);
    return hit;
  };

  test('FORM_VERSION is 7', () => {
    expect(FORM_VERSION).toBe('7');
  });

  test('both parts take the switch options from the endpoint, declared as a list on the screen', () => {
    for (const [id, p] of [['PART_ONE', 'p1'], ['PART_TWO', 'p2']]) {
      expect(find(screens[id], `${p}_change_how`)['data-source']).toBe('${data.switched}');
      expect(screens[id].data.switched.type).toBe('array');
      expect(screens[id].data.switched.__example__.map((o) => o.id)).toEqual(IDS);
    }
  });

  test('the v5 snapshot differs only in that data-source, its declaration and the form version', () => {
    const now = JSON.parse(JSON.stringify(flow));
    const old = JSON.parse(JSON.stringify(V5_FORM));
    const strip = (f) => {
      for (const s of f.screens) {
        delete (s.data || {}).switched;
        // bd-ra8xu.43: the rubric caption atop Part 1 (one TextCaption + its declaration) is the other allowed difference.
        delete (s.data || {}).scored_with;
        const dropCaption = (list) => (Array.isArray(list) ? list.filter((c) => !(c && c.type === 'TextCaption' && c.text === '${data.scored_with}')) : list);
        (s.layout.children || []).forEach((c) => { if (c && c.children) c.children = dropCaption(c.children); });
        const walk = (list) => (list || []).forEach((c) => {
          if (/_change_how$/.test(c.name || '')) c['data-source'] = 'X';
          if (c['on-click-action'] && c['on-click-action'].payload && c['on-click-action'].payload.fv) c['on-click-action'].payload.fv = 'FV';
          walk(c.children); walk(c.then); walk(c.else);
        });
        walk(s.layout.children);
      }
      return f;
    };
    expect(strip(now)).toEqual(strip(old));
  });
});

describe('the endpoint fills the switch options per visit', () => {
  test('a v5 visit: today\'s titles (PLAIN.C5) and descriptions, ids slowest first', async () => {
    const id = await newForm();
    const out = await Endpoint.handleObserve2FormInit(token(id));
    expect(out.screen).toBe('PART_ONE');
    expect(out.data.switched.map((o) => o.id)).toEqual(IDS);
    expect(out.data.switched.map((o) => o.title)).toEqual(PLAIN.C5);
    expect(out.data.switched.map((o) => o.description)).toEqual(V5_DESCRIPTIONS);
  });

  test('a v6 visit: the §7.5 minutes, the v6 level text as the description, the same ids', async () => {
    setSwitch('v6');
    const id = await newForm();
    expect(row(id).rubric_version).toBe('fico17_v6');
    const out = await Endpoint.handleObserve2FormInit(token(id));
    expect(out.data.switched.map((o) => o.id)).toEqual(IDS);
    expect(out.data.switched.map((o) => o.title)).toEqual(V6_TITLES);
    expect(out.data.switched.map((o) => o.description)).toEqual([1, 2, 3, 4].map((n) => V6.clip(V6.levelText('C5', n), 300)));
    for (const o of out.data.switched) expect([...o.title].length).toBeLessThanOrEqual(30);
  });

  test('Part 2 gets the list too: after Part 1, on a reopened form, and when refused', async () => {
    setSwitch('v6');
    const id = await newForm();
    const p2 = await Endpoint.handleObserve2FormDataExchange(token(id), 'PART_ONE', PART_1_OK);
    expect(p2.screen).toBe('PART_TWO');
    expect(p2.data.switched.map((o) => o.title)).toEqual(V6_TITLES);
    const cont = await Endpoint.handleObserve2FormDataExchange(token(id), 'CONTINUE', { screen: 'CONTINUE', fv: '7', prefill: '1' });
    expect(cont.screen).toBe('PART_TWO');
    expect(cont.data.switched.map((o) => o.title)).toEqual(V6_TITLES);
    const refused = await Endpoint.handleObserve2FormDataExchange(token(id), 'PART_TWO', { screen: 'PART_TWO', fv: '7', p2_spoke: '' });
    expect(refused.screen).toBe('PART_TWO');
    expect(refused.data.switched.map((o) => o.id)).toEqual(IDS);
  });

  test('Part 1 refused keeps the list; a token with no record gets the v5 list', async () => {
    const id = await newForm();
    const refused = await Endpoint.handleObserve2FormDataExchange(token(id), 'PART_ONE', { ...PART_1_OK, p1_spoke: '99' });
    expect(refused.screen).toBe('PART_ONE');
    expect(refused.data.switched.map((o) => o.title)).toEqual(PLAIN.C5);
    const gone = await Endpoint.handleObserve2FormDataExchange(token('no-such-form'), 'PART_ONE', PART_1_OK);
    expect(gone.data.switched.map((o) => o.title)).toEqual(PLAIN.C5);
  });

  test('the ids are the rules\' SWITCH, so a sealed answer scores the same on either visit', () => {
    expect(Object.keys(SWITCH)).toEqual(IDS);
    expect(IDS.map((i) => SWITCH[i])).toEqual([1, 2, 3, 4]);
  });
});
