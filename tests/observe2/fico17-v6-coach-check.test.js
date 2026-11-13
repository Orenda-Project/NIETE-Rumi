/**
 * bd-ra8xu.50 — the FICO17 v6 coach's own copy of the /observe2 check (operator 13 Nov): every level the coach
 * chooses is the level's name with the rubric's text under it, no N/A and no Couldn't tell, and D2 has no count
 * boxes. It is its own Flow (observe2-evidence-check-v6.json, OBSERVE2_CHECK_V6_FLOW_ID), sent only for a v6 visit;
 * the shared check every other /observe2 visit opens is built and served exactly as before. The copy posts check
 * version 4 from the last moments screen, and the endpoint applies the coach's rules only on that version.
 *
 * Real: endpoint, store, rules, switch. Mocked: the database (in-memory), WhatsApp.
 */
const { createFakeSupabase } = require('./helpers/fake-supabase');

let mockFake;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendFlow: jest.fn(() => Promise.resolve(true)),
  sendInteractiveButtons: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/observe/observe-debrief.service', () => ({
  displayTimeZone: () => 'Asia/Karachi',
  buildDebriefChoiceButtons: jest.fn((sessionId, S) => ({ body: S.debrief_choice_body, buttons: [{ id: `observe_debrief_now_${sessionId}` }] })),
}));

const fs = require('fs');
const path = require('path');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const Check = require('../../bot/shared/routes/observe2-check-endpoint');
const Switch = require('../../bot/shared/services/coaching/fico-rubric-switch');
const V6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const Moments = require('../../bot/shared/services/observe/observe2/moments');
const { buildEvidenceCheckFlow, COACH_CHECK, V6_CHECK } = require('../../bot/shared/services/observe/observe2/evidence-check.flow');

const token = (id, userId = 'coach-1') => `${userId}:observe2-check:${id}`;
const row = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);
const setSwitch = (value) => {
  mockFake.__tables.app_settings = value == null ? [] : [{ key: 'fico_coach_rubric', value }];
  Switch._resetCache();
};
const ANSWERS = {
  present: '32', p1_spoke: '6', p1_picked: 'once', p1_groups: 'alone', p1_listen: ['turns'], p1_materials: 'teacher', p1_change: 'yes', p1_change_how: 'slow',
  p2_spoke: '10', p2_new: '5', p2_picked: 'often', p2_groups: 'combine', p2_listen: ['once'], p2_materials: 'children', p2_change: 'no',
  incident: 'none', lp: 'used', priority: 'C8',
};
const MOMENTS = [
  { id: 'ask_1', moment: 'ask', type: 'open_q_one', minute: '00:40', quote: 'Why do plants need sunlight? Ali?', label: 'open question' },
  { id: 'wrong_1', moment: 'wrong', type: 'wrong_ignored', minute: '05:10', quote: 'No, that is wrong. Who else?', label: 'wrong answer left' },
];
async function checkable() {
  const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: {} });
  Object.assign(row(form.id), {
    period_minutes: 40, answers: ANSWERS, sealed_at: '2026-11-12T05:39:00.000Z', part1_done_at: 'x', part2_done_at: 'x',
    coaching_session_id: 'sess-1', rumi_moments: { moments: MOMENTS, counts: { closed_q: 3 } },
    rumi_levels: { C1: { level: 2 } }, moments_ready_at: '2026-11-12T05:50:00.000Z',
  });
  return form.id;
}
const heard = (screen, extra = {}) => {
  const out = { screen, ...extra };
  for (let i = 1; i <= 8; i += 1) out[`${screen.toLowerCase()}_${i}`] = '';
  return out;
};
const ex = (id, screen, data) => Check.handleObserve2CheckDataExchange(token(id), screen, { screen, ...data });
async function toCombined(id, v6c) {
  for (const s of ['HEARD_ASK', 'HEARD_WRONG', 'HEARD_WORK']) await ex(id, s, heard(s));
  const out = await ex(id, 'HEARD_EXPLAIN', heard('HEARD_EXPLAIN', { v6c }));
  // A branch whose check has the "missed moments" screen goes through it first; one without goes straight on.
  return out.screen === 'MISSED' ? ex(id, 'MISSED', {}) : out;
}
const WHY = 'I saw it from the back of the room myself.';
const C1 = { cmb_C3_level: '3', cmb_C3_why: WHY, cmb_C5_level: '2', cmb_C5_why: WHY };
const C2 = { cmb_C7_level: '2', cmb_C7_why: WHY, cmb_D3_level: '1', cmb_D3_why: WHY };
const C3 = { cmb_D4_level: '3', cmb_D4_why: WHY, cmb_D2_level: '3', cmb_D2_why: WHY };

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.OBSERVE2_CHECK_V6_FLOW_ID;
  mockFake = createFakeSupabase({
    users: [
      { id: 'coach-1', phone_number: '923000000001', name: 'Coach', preferred_language: 'en', region: 'Sihala' },
      { id: 'teacher-1', phone_number: '923000000002', name: 'Rabia', preferred_language: 'en', teacher_level: ['PRIMARY'] },
    ],
    coaching_sessions: [{ id: 'sess-1', status: 'observe2_checking' }],
  });
  Switch._resetCache();
});

describe('the coach\'s copy of the check Flow', () => {
  const copy = buildEvidenceCheckFlow({ coach2: true });
  const shared = buildEvidenceCheckFlow();
  const comps = (s) => { const out = []; const walk = (l) => (l || []).forEach((c) => { out.push(c); walk(c.children); }); walk(s.layout.children); return out; };
  const screen = (f, id) => f.screens.find((s) => s.id === id);

  test('every v6 level choice is the level name with the rubric text; no N/A, no Couldn\'t tell; no D2 boxes', () => {
    for (const id of ['COMBINED_ONE', 'COMBINED_TWO', 'COMBINED_THREE', 'ADDED_DC_ONE', 'ADDED_DC_TWO']) {
      for (const r of comps(screen(copy, id)).filter((c) => c.type === 'RadioButtonsGroup' && /^(cmb_|[CDF]\d_final)/.test(c.name))) {
        const code = r.name.replace(/^cmb_/, '').slice(0, 2);
        expect(r['data-source']).toEqual(V6.coachLevelOptions(code, 'en'));
      }
    }
    const json = JSON.stringify(copy);
    expect(json).not.toMatch(/d2_children|d2_quiet_later|COMBINED_THREE_COUNTS/);
    const v6Json = JSON.stringify(copy.screens.filter((x) => /^(COMBINED|ADDED_DC)/.test(x.id)));
    expect(v6Json).not.toMatch(/"id":"(NA|IE)"/); // the v5 screens keep v5's own options
  });

  test('the copy posts check version 4; the shared Flow is unchanged and still posts its own version', () => {
    const v6cOf = (f) => comps(screen(f, 'HEARD_EXPLAIN')).find((c) => c.type === 'Footer')['on-click-action'].payload.v6c;
    expect(v6cOf(copy)).toBe(COACH_CHECK);
    expect(COACH_CHECK).toBe('4');
    expect(v6cOf(shared)).toBe(V6_CHECK);
    const committed = JSON.parse(fs.readFileSync(path.join(__dirname, '../../docs/flows/observe2-evidence-check.json'), 'utf8'));
    expect(committed).toEqual(shared);
    const committedCopy = JSON.parse(fs.readFileSync(path.join(__dirname, '../../docs/flows/observe2-evidence-check-v6.json'), 'utf8'));
    expect(committedCopy).toEqual(copy);
  });

  test('the v5 screens of the copy are the shared Flow\'s, screen for screen', () => {
    for (const s of shared.screens.filter((x) => !/^(COMBINED|ADDED_DC|MISSED|HEARD_EXPLAIN)/.test(x.id))) {
      expect(screen(copy, s.id)).toEqual(s);
    }
  });
});

describe('a v6 visit on the coach\'s copy', () => {
  beforeEach(() => setSwitch('v6'));

  test('N/A is refused for a room level; D2 needs no counts; nothing is stored for counts', async () => {
    const id = await checkable();
    const first = await toCombined(id, COACH_CHECK);
    expect(first.screen).toBe('COMBINED_ONE');
    expect(row(id).evidence_review.v6_check).toBe(4);
    await ex(id, 'COMBINED_ONE', C1);
    let out = await ex(id, 'COMBINED_TWO', { ...C2, cmb_C7_level: 'NA' });
    expect(out.screen).toBe('COMBINED_TWO');
    expect(out.data.error_messages).toEqual({ cmb_C7_level: 'Choose a level.' });
    out = await ex(id, 'COMBINED_TWO', C2);
    expect(out.screen).toBe('COMBINED_THREE');
    out = await ex(id, 'COMBINED_THREE', C3);
    expect(out.screen).toBe('ADDED_DC_ONE');
    expect(row(id).evidence_review.d2_counts).toBeUndefined();
    expect(row(id).evidence_review.v6_D2).toMatchObject({ level: 3, set_by: 'coach', prompt_version: V6.COACH_PROMPT_VERSION });
  });

  test('on the shared Flow the old rules still hold: D2 asks its counts', async () => {
    const id = await checkable();
    await toCombined(id, V6_CHECK);
    await ex(id, 'COMBINED_ONE', C1);
    await ex(id, 'COMBINED_TWO', C2);
    const out = await ex(id, 'COMBINED_THREE', C3);
    expect(out.data.error_messages).toEqual({ d2_children: 'Check the two numbers.' });
  });
});

describe('which check a visit is sent', () => {
  const v6Form = { id: 'f6', rubric_version: 'fico17_v6', observer_user_id: 'coach-1', rumi_moments: { moments: [] } };
  const v5Form = { id: 'f5', rubric_version: 'fico-ict-17-2026-09', observer_user_id: 'coach-1', rumi_moments: { moments: [] } };
  beforeEach(() => { process.env.OBSERVE2_CHECK_FLOW_ID = 'shared-check'; });

  test('a v6 visit gets the coach\'s copy once its Flow ID is set; a v5 visit always the shared check', async () => {
    process.env.OBSERVE2_CHECK_V6_FLOW_ID = 'coach-check';
    await Moments.openCheck(v6Form);
    await Moments.openCheck(v5Form);
    expect(WhatsAppService.sendFlow.mock.calls.map((c) => c[1].flowId)).toEqual(['coach-check', 'shared-check']);
  });

  test('until the copy is published, a v6 visit gets the shared check as before', async () => {
    await Moments.openCheck(v6Form);
    expect(WhatsAppService.sendFlow.mock.calls[0][1].flowId).toBe('shared-check');
  });
});
