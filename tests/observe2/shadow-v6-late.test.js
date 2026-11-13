/**
 * FICO6 fix-shadow (bd-qix9oh.241; e2e board 20261111T154450_e2e_fail): the /observe2 shadow v6 read is stored in the
 * session however late it lands.
 *
 * The check's hand-over copies rumi_moments.shadow_v6 into analysis_data.observe2.shadow_v6 (analysis.js, LIFTED), but
 * only what the form held when the check ended. A coach who finishes before the background read left no shadow_v6 in
 * the session (staging form 83337cc5: check 15:44:03Z, shadow read 15:44:19Z). Now the read, once stored on the form,
 * patches observe2.shadow_v6 into the handed-over session: that key only, idempotent, never over another writer.
 *
 * Real: shadow-v6, the late write, moments, the gate, quote and label checks, rules, store, switch, the check endpoint,
 * analysis.js. Mocked at the boundary: the database (in memory, with the updated_at trigger), WhatsApp, the logger,
 * the debrief offer, the model.
 */
const { createFakeSupabase } = require('./helpers/fake-supabase');

let mockFake;
// coaching_sessions has a BEFORE UPDATE trigger that sets updated_at (supabase/baseline/schema.sql): every update
// through this stand-in moves it on, as the database does, so a write guarded by an old updated_at matches no row.
let mockTick = 0;
let mockBeforeUpdate = null;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (table) => {
    const b = mockFake.from(table);
    if (table !== 'coaching_sessions') return b;
    const update = b.update;
    b.update = (values) => {
      if (mockBeforeUpdate) { const hook = mockBeforeUpdate; mockBeforeUpdate = null; hook(); }
      mockTick += 1;
      return update({ ...values, updated_at: `2026-11-11T15:44:${String(mockTick).padStart(2, '0')}.000000+00:00` });
    };
    return b;
  },
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendFlow: jest.fn(() => Promise.resolve(true)),
  sendInteractiveButtons: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/observe/observe-debrief.service', () => ({
  displayTimeZone: () => 'Asia/Karachi',
  buildDebriefChoiceButtons: jest.fn((sessionId, S) => ({ body: S.debrief_choice_body, buttons: [{ id: `observe_debrief_now_${sessionId}` }] })),
  acknowledgeFormSubmitted: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/child-test/conversation/offer', () => ({ sendOffer: jest.fn(() => Promise.resolve()) }));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const Debrief = require('../../bot/shared/services/observe/observe-debrief.service');
const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const Switch = require('../../bot/shared/services/coaching/fico-rubric-switch');
const Moments = require('../../bot/shared/services/observe/observe2/moments');
const Check = require('../../bot/shared/routes/observe2-check-endpoint');
const Shadow = require('../../bot/shared/services/observe/observe2/shadow-v6');

const LINES = [
  ['00:30', 'Teacher', 'Ali, what do you think a plant needs to grow?'],
  ['00:45', 'Student', 'I think it needs water and sunlight.'],
  ['02:30', 'Teacher', 'Open your book to page 12 and find the picture of the plant.'],
  ['05:00', 'Teacher', 'Everyone, tell your partner your answer now.'],
  ['07:30', 'Teacher', 'Sara, why do you think the roots are at the bottom?'],
  ['07:50', 'Student', 'Because they take water from the soil.'],
  ['10:00', 'Student', 'I agree with her about the roots.'],
  ['12:30', 'Teacher', 'Pens down, now turn to page twenty please.'],
  ['15:00', 'Teacher', "In your group, make one chart together with everyone's ideas."],
  ['17:30', 'Teacher', 'One of you is the writer, one is the speaker.'],
  ['20:00', 'Teacher', 'Hina, what is your answer for this question?'],
  ['22:30', 'Teacher', 'Omar, can you add to what Hina said?'],
  ['25:00', 'Teacher', 'Bilal, tell us what your group found today.'],
  ['27:30', 'Teacher', 'Ayesha, which part of the plant makes food?'],
  ['30:00', 'Student', 'The leaves make food for the plant.'],
  ['32:30', 'Teacher', 'Zara, what happens to a plant in the dark?'],
  ['35:00', 'Student', 'It cannot make its food without light.'],
  ['37:30', 'Teacher', 'Good thinking, you used what we learned about leaves.'],
  ['39:00', 'Teacher', 'That is the end of our lesson for today.'],
];
const OK_T = LINES.map(([t, who, w]) => `[${t}] ${who} (EN): ${w}`).join('\n\n');
const MODEL_V3 = {
  moments: [
    { moment: 'ask', type: 'open_q_one', minute: '00:30', quote: 'Ali, what do you think a plant needs to grow? — I think it needs water and sunlight.', why: 'An open question a child answered.' },
    { moment: 'ask', type: 'reasoning', minute: '07:50', quote: 'Because they take water from the soil.', why: 'A child gave a reason.' },
  ],
  counts: { closed_q: 3, praise_generic: 1 },
  room: [{ code: 'C3', kind: 'pair_talk', minute: '05:00', quote: 'Everyone, tell your partner your answer now.' }],
};
const MODEL_V2 = {
  moments: [{ moment: 'ask', type: 'open_q_one', minute: '00:30', quote: 'Ali, what do you think a plant needs to grow? — I think it needs water and sunlight.', why: 'An open question a child answered.' }],
  counts: { closed_q: 2, praise_generic: 0 },
};
const KEEP_ALL = { verdicts: [1, 2, 3].map((n) => ({ n, verdict: 'keep' })) };
const isV3 = (prompt) => /ROOM EVIDENCE/.test(prompt);
const held = () => {
  let release;
  const promise = new Promise((r) => { release = () => r(MODEL_V3); });
  return { promise, release };
};
const ANSWERS = {
  present: '32', p1_spoke: '6', p1_picked: 'once', p1_groups: 'alone', p1_listen: ['turns'], p1_materials: 'teacher', p1_change: 'yes', p1_change_how: 'slow',
  p2_spoke: '10', p2_new: '5', p2_picked: 'often', p2_groups: 'combine', p2_listen: ['once'], p2_materials: 'children', p2_change: 'no',
  incident: 'none', lp: 'used', priority: 'C8',
};

const formRow = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);
const session = () => mockFake.__tables.coaching_sessions[0];
const copy = (v) => JSON.parse(JSON.stringify(v));
const withoutShadow = (ad) => {
  const c = copy(ad);
  delete c.observe2.shadow_v6;
  return c;
};

async function shadowVisit() {
  mockFake.__tables.app_settings = [{ key: 'fico_coach_rubric', value: 'shadow' }];
  Switch._resetCache();
  const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: {} });
  Object.assign(formRow(form.id), { period_minutes: 40, sealed_at: '2026-11-11T05:39:00.000Z', answers: ANSWERS, part1_done_at: 'x', part2_done_at: 'x' });
  mockFake.__tables.coaching_sessions = [{
    id: 'sess-1', status: 'transcription_complete', transcript_text: OK_T, observation_type: 'leader_observation',
    observer_user_id: 'coach-1', user_id: 'teacher-1', updated_at: '2026-11-11T15:40:00.000000+00:00',
    analysis_data: { framework: 'fico', live_moves: { taps: 2 } },
  }];
  await Store.linkSession(form.id, 'sess-1');
  return formRow(form.id);
}

const token = (id) => `coach-1:observe2-check:${id}`;
const ex = (id, screen, data) => Check.handleObserve2CheckDataExchange(token(id), screen, { screen, ...data });
const heard = (screen, answers = {}) => {
  const out = { screen };
  for (let i = 1; i <= 8; i += 1) out[`${screen.toLowerCase()}_${i}`] = answers[i] || '';
  return out;
};
async function walkTheCheck(id) {
  await ex(id, 'HEARD_ASK', heard('HEARD_ASK', { 1: 'yes' }));
  await ex(id, 'HEARD_WRONG', heard('HEARD_WRONG'));
  await ex(id, 'HEARD_WORK', heard('HEARD_WORK'));
  await ex(id, 'HEARD_EXPLAIN', heard('HEARD_EXPLAIN'));
  await ex(id, 'ADDED_ONE', { C1_final: '2', C2_final: '1', C3_final: '3', C6_final: '2', D1_final: '2', D2_final: '4', D4_final: 'IE', D5_final: '1' });
  await ex(id, 'ADDED_TWO', { C4_final: '1', C5_final: '2', C7_final: '3', C8_final: '3', D3_final: '2', F1_final: '3', F2_final: '2', F3_final: '2', F4_final: '1' });
  return ex(id, 'PRIORITY', { priority_final: 'C8', why: '' });
}

// The late write waits between its passes; the fake clock runs them in an instant.
async function settle() {
  let done = false;
  const all = Shadow.idle().then(() => { done = true; });
  for (let i = 0; i < 200 && !done; i += 1) await jest.advanceTimersByTimeAsync(5000);
  await all;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTick = 0;
  mockBeforeUpdate = null;
  mockFake = createFakeSupabase({
    users: [{ id: 'coach-1', phone_number: '923000000001', name: 'Coach', preferred_language: 'en', region: 'Sihala' },
      { id: 'teacher-1', phone_number: '923000000002', name: 'Teacher', preferred_language: 'en', teacher_level: ['PRIMARY'] }],
  });
  Switch._resetCache();
  process.env.OBSERVE2_CHECK_FLOW_ID = 'F-CHECK';
});
afterEach(() => { jest.useRealTimers(); });
afterAll(() => { delete process.env.OBSERVE2_CHECK_FLOW_ID; });

describe('the check ends before the shadow v6 read does (e2e 154450)', () => {
  test('the late read lands in analysis_data.observe2.shadow_v6; every other field is byte-identical; nothing is sent', async () => {
    const f = await shadowVisit();
    const call = held();
    const llm = jest.fn((prompt) => (isV3(prompt) ? call.promise : Promise.resolve(MODEL_V2)));
    const out = await Moments.runForSession('sess-1', '923000000001', { llm, labelLlm: jest.fn(() => Promise.resolve(KEEP_ALL)) });
    expect(out).toMatchObject({ handled: true, action: 'check_sent' });

    // The coach checks quickly: the v6 read is still out.
    const done = await walkTheCheck(f.id);
    expect(done.screen).toBe('DONE');
    await new Promise((r) => setImmediate(r)); // the debrief offer the check schedules
    expect(formRow(f.id).checked_at).toBeTruthy();
    expect(formRow(f.id).rumi_moments).not.toHaveProperty('shadow_v6');
    expect(session().status).toBe('observer_review_complete');
    expect(session().analysis_data.observe2).not.toHaveProperty('shadow_v6'); // today's defect, before the read lands
    const v5 = copy(session().analysis_data);
    const sent = { flows: WhatsAppService.sendFlow.mock.calls.length, messages: WhatsAppService.sendMessage.mock.calls.length,
      buttons: WhatsAppService.sendInteractiveButtons.mock.calls.length, debrief: Debrief.acknowledgeFormSubmitted.mock.calls.length };

    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'Date'] });
    call.release();
    await settle();

    const blob = formRow(f.id).rumi_moments.shadow_v6;
    expect(blob).toMatchObject({ status: 'ok', prompt_version: 'observe2-moments-v3.1' });
    const ad = session().analysis_data;
    expect(ad.observe2.shadow_v6).toEqual(blob);
    expect(JSON.stringify(withoutShadow(ad))).toBe(JSON.stringify(v5)); // v5 fields, key order and all
    expect(ad.observe2.rubric).toBe('fico17');
    expect(session().status).toBe('observer_review_complete');
    expect({ flows: WhatsAppService.sendFlow.mock.calls.length, messages: WhatsAppService.sendMessage.mock.calls.length,
      buttons: WhatsAppService.sendInteractiveButtons.mock.calls.length, debrief: Debrief.acknowledgeFormSubmitted.mock.calls.length }).toEqual(sent);
  });

  test('a read that lands before the check ends is lifted by the check, and the session is not written again', async () => {
    const f = await shadowVisit();
    const llm = jest.fn((prompt) => Promise.resolve(isV3(prompt) ? MODEL_V3 : MODEL_V2));
    await Moments.runForSession('sess-1', '923000000001', { llm, labelLlm: jest.fn(() => Promise.resolve(KEEP_ALL)) });
    await Shadow.idle();
    expect(formRow(f.id).rumi_moments.shadow_v6.status).toBe('ok');
    const writesBefore = mockFake.__calls.filter((c) => c.table === 'coaching_sessions' && c.action === 'update').length;
    await walkTheCheck(f.id);
    await new Promise((r) => setImmediate(r));
    expect(session().analysis_data.observe2.shadow_v6).toEqual(formRow(f.id).rumi_moments.shadow_v6);
    // The check's own hand-over write only.
    expect(mockFake.__calls.filter((c) => c.table === 'coaching_sessions' && c.action === 'update')).toHaveLength(writesBefore + 1);
  });
});

describe('the late write against the other writers of the session', () => {
  // A read that finished after the check: the form is checked, the blob is on the form, the session is as handed over.
  async function checkedThenRead({ handedOver = true } = {}) {
    const f = await shadowVisit();
    Object.assign(formRow(f.id), {
      checked_at: '2026-11-11T15:44:03.000Z',
      rumi_moments: { moments: [], counts: MODEL_V2.counts, prompt_version: 'observe2-moments-v2' },
    });
    if (handedOver) {
      Object.assign(session(), {
        status: 'observer_review_complete',
        analysis_data: { framework: 'fico', live_moves: { taps: 2 }, observe2: { form_id: f.id, rubric: 'fico17', final_levels: { C1: '2' } } },
      });
    }
    return formRow(f.id);
  }
  const run = async (f) => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'Date'] });
    await Shadow.runFor(f, OK_T, { llm: () => Promise.resolve(MODEL_V3), labelLlm: () => Promise.resolve(KEEP_ALL) });
    await settle();
  };

  test('idempotent: a second run with the same blob does not write the session again', async () => {
    const f = await checkedThenRead();
    await run(f);
    const blob = formRow(f.id).rumi_moments.shadow_v6;
    expect(session().analysis_data.observe2.shadow_v6).toEqual(blob);
    const after = copy(session());
    const writes = mockFake.__calls.filter((c) => c.table === 'coaching_sessions' && c.action === 'update').length;
    // The same blob, patched again (e.g. a repeat of the job): read, found, left alone.
    const LateWrite = require('../../bot/shared/services/coaching/frameworks/fico17-v6/late-write');
    const res = await LateWrite.patchSession('sess-1', LateWrite.observe2ShadowV6(f.id, blob), { sleep: () => Promise.resolve() });
    expect(res).toMatchObject({ ok: true, written: false });
    expect(mockFake.__calls.filter((c) => c.table === 'coaching_sessions' && c.action === 'update')).toHaveLength(writes);
    expect(session()).toEqual(after);
  });

  test('the check has not handed the visit over yet: the write waits for it, and never runs ahead of it', async () => {
    const f = await checkedThenRead({ handedOver: false });
    const LateWrite = require('../../bot/shared/services/coaching/frameworks/fico17-v6/late-write');
    const real = LateWrite.timing.sleep;
    let handed = false;
    LateWrite.timing.sleep = async (ms) => {
      // The hand-over lands while the late write waits (it spreads the row it read and lifts what the form held).
      if (!handed) {
        handed = true;
        Object.assign(session(), {
          status: 'observer_review_complete', updated_at: '2026-11-11T15:44:59.000000+00:00',
          analysis_data: { ...session().analysis_data, observe2: { form_id: f.id, rubric: 'fico17', final_levels: { C1: '2' } } },
        });
      }
      return real(ms);
    };
    try {
      await run(f);
    } finally {
      LateWrite.timing.sleep = real;
    }
    expect(handed).toBe(true);
    const ad = session().analysis_data;
    expect(ad.observe2.shadow_v6).toEqual(formRow(f.id).rumi_moments.shadow_v6);
    expect(ad.observe2.final_levels).toEqual({ C1: '2' });
    expect(ad.live_moves).toEqual({ taps: 2 });
  });

  test('a writer between our read and our write wins: our write matches no row, is read again, and keeps its key', async () => {
    const f = await checkedThenRead();
    mockBeforeUpdate = () => {
      // Another writer (the debrief's own merge) updates the row: the trigger moves updated_at on.
      Object.assign(session(), {
        updated_at: '2026-11-11T15:45:30.000000+00:00',
        analysis_data: { ...session().analysis_data, observer_debrief: { status: 'started' } },
      });
    };
    await run(f);
    const ad = session().analysis_data;
    expect(ad.observer_debrief).toEqual({ status: 'started' });
    expect(ad.observe2.shadow_v6).toEqual(formRow(f.id).rumi_moments.shadow_v6);
    const guarded = mockFake.__calls.filter((c) => c.table === 'coaching_sessions' && c.action === 'update');
    expect(guarded.length).toBe(2);
    for (const c of guarded) expect(c.filters.some(([op, col]) => op === 'eq' && col === 'updated_at')).toBe(true);
  });

  test('a whole-blob rewriter that read before the write and wrote after it: the shadow is written back', async () => {
    const f = await checkedThenRead();
    const LateWrite = require('../../bot/shared/services/coaching/frameworks/fico17-v6/late-write');
    const real = LateWrite.timing.sleep;
    const stale = copy(session().analysis_data);
    let clobbered = false;
    LateWrite.timing.sleep = async (ms) => {
      if (!clobbered && session().analysis_data.observe2.shadow_v6) {
        clobbered = true;
        Object.assign(session(), { updated_at: '2026-11-11T15:46:00.000000+00:00', analysis_data: { ...stale, observer_debrief: { status: 'done' } } });
      }
      return real(ms);
    };
    try {
      await run(f);
    } finally {
      LateWrite.timing.sleep = real;
    }
    expect(clobbered).toBe(true);
    expect(session().analysis_data.observe2.shadow_v6).toEqual(formRow(f.id).rumi_moments.shadow_v6);
    expect(session().analysis_data.observer_debrief).toEqual({ status: 'done' });
  });

  test('a form that is not checked: the session is never read or written (the check lifts the blob itself)', async () => {
    const f = await shadowVisit();
    await run(f);
    expect(formRow(f.id).rumi_moments.shadow_v6.status).toBe('ok');
    expect(mockFake.__calls.filter((c) => c.table === 'coaching_sessions')).toHaveLength(0);
  });

  test('a v5 visit (no shadow): nothing runs, nothing is written', async () => {
    mockFake.__tables.app_settings = [];
    Switch._resetCache();
    const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: {} });
    const res = await Shadow.runFor(formRow(form.id), OK_T, { llm: jest.fn() });
    expect(res.started).toBe(false);
    expect(mockFake.__calls.filter((c) => c.table === 'coaching_sessions')).toHaveLength(0);
  });
});
