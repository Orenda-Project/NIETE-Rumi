/**
 * /observe2 shadow mode (spec §4.2, §10.2 bullet 2; CONTRACTS §2, §8; bd-qix9oh.5).
 *
 * fico_coach_rubric = shadow: the visit is v5 in every respect the coach and the teacher see (stamp, prompt v2,
 * rules, check screens), and beside it the same transcript is read once more on v6 (the gate, the v3 prompt, the
 * v6 rules) and stored under rumi_moments.shadow_v6. That second read runs in the background: it never throws
 * into the moments job and never holds up the check.
 *
 * Real: shadow-v6, moments, the gate, quote and label checks, rules, store, switch, the check endpoint. Mocked at
 * the boundary: the database (in memory), WhatsApp, the logger, the model.
 */
const { createFakeSupabase } = require('./helpers/fake-supabase');

let mockFake;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendFlow: jest.fn(() => Promise.resolve(true)),
  sendInteractiveButtons: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/observe/observe-debrief.service', () => ({
  displayTimeZone: () => 'Asia/Karachi',
  buildDebriefChoiceButtons: jest.fn((sessionId, S) => ({ body: S.debrief_choice_body, buttons: [{ id: `observe_debrief_now_${sessionId}` }] })),
}));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const Rubric = require('../../bot/shared/services/observe/observe2/rubric');
const Switch = require('../../bot/shared/services/coaching/fico-rubric-switch');
const Moments = require('../../bot/shared/services/observe/observe2/moments');
const Rules = require('../../bot/shared/services/observe/observe2/rules');
const Quality = require('../../bot/shared/services/observe/transcript-quality');
const Check = require('../../bot/shared/routes/observe2-check-endpoint');
const Shadow = require('../../bot/shared/services/observe/observe2/shadow-v6');

const V5 = 'fico-ict-17-2026-09';
const COMBINED = ['C3', 'C5', 'C7', 'D2', 'D3', 'D4'];

// A 40-minute lesson with a line at most every 2:30 to 39:00: the gate calls it ok.
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
const timed = (lines) => lines.map(([t, who, w]) => `[${t}] ${who} (EN): ${w}`).join('\n\n');
const OK_T = timed(LINES);
const PARTIAL_T = timed(LINES.slice(0, 11)); // stops at 20:00 of 40: short
const BROKEN_T = [ // one Urdu word from 02:00 to 39:30: a loop over half the period
  '[00:30] Teacher (UR): آج ہم پودوں کے بارے میں پڑھیں گے۔',
  ...Array.from({ length: 76 }, (_, i) => {
    const s = 120 + i * 30;
    return `[${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}] Student (UR): ٹھیک ٹھیک ٹھیک`;
  }),
].join('\n\n');

// The v3 reply: a v6-only type (resource_used) and room evidence.
const MODEL_V3 = {
  moments: [
    { moment: 'ask', type: 'open_q_one', minute: '00:30', quote: 'Ali, what do you think a plant needs to grow? — I think it needs water and sunlight.', why: 'An open question a child answered.' },
    { moment: 'explain', type: 'resource_used', minute: '02:30', quote: 'Open your book to page 12 and find the picture of the plant.', why: 'The children used the book.' },
    { moment: 'ask', type: 'reasoning', minute: '07:50', quote: 'Because they take water from the soil.', why: 'A child gave a reason.' },
  ],
  counts: { closed_q: 3, praise_generic: 1 },
  room: [
    { code: 'C3', kind: 'pair_talk', minute: '05:00', quote: 'Everyone, tell your partner your answer now.' },
    { code: 'C5', kind: 'signal', minute: '12:30', quote: 'Pens down, now turn to page twenty please.', starts: '12:50' },
  ],
};
// The v2 reply the coach's own (v5) moments come from.
const MODEL_V2 = {
  moments: [{ moment: 'ask', type: 'open_q_one', minute: '00:30', quote: 'Ali, what do you think a plant needs to grow? — I think it needs water and sunlight.', why: 'An open question a child answered.' }],
  counts: { closed_q: 2, praise_generic: 0 },
};
const KEEP_ALL = { verdicts: [1, 2, 3].map((n) => ({ n, verdict: 'keep' })) };
const isV3 = (prompt) => /ROOM EVIDENCE/.test(prompt);
// A model call that answers only when the test lets it: "hung" while the caller is checked, released after.
const held = () => {
  let release;
  const promise = new Promise((r) => { release = () => r(MODEL_V3); });
  return { promise, release };
};

const formRow = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);
const setSwitch = (value) => {
  mockFake.__tables.app_settings = value == null ? [] : [{ key: 'fico_coach_rubric', value }];
  Switch._resetCache();
};

async function visit({ swValue = 'shadow', transcript = OK_T, sealed = true, patch = {} } = {}) {
  setSwitch(swValue);
  const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: {} });
  Object.assign(formRow(form.id), { period_minutes: 40, ...(sealed ? { sealed_at: '2026-11-11T05:39:00.000Z' } : {}) }, patch);
  mockFake.__tables.coaching_sessions = [{ id: 'sess-1', status: 'transcription_complete', transcript_text: transcript, observation_type: 'leader_observation', observer_user_id: 'coach-1', user_id: 'teacher-1' }];
  await Store.linkSession(form.id, 'sess-1');
  return formRow(form.id);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFake = createFakeSupabase({
    users: [{ id: 'coach-1', phone_number: '923000000001', name: 'Coach', preferred_language: 'en', region: 'Sihala' },
      { id: 'teacher-1', phone_number: '923000000002', name: 'Rabia', preferred_language: 'en', teacher_level: ['PRIMARY'] }], // bd-ra8xu.42: grades 1-5 gate
  });
  Switch._resetCache();
  process.env.OBSERVE2_CHECK_FLOW_ID = 'F-CHECK';
});
afterAll(() => { delete process.env.OBSERVE2_CHECK_FLOW_ID; });

describe('the stamp', () => {
  test('switch shadow: v5 stamp, visit_context.shadow_v6, rubricFor fico17', async () => {
    const f = await visit();
    expect(f.rubric_version).toBe(V5);
    expect(f.visit_context.shadow_v6).toBe(true);
    expect(Rubric.isShadow(f)).toBe(true);
    expect(Rubric.isV6(f)).toBe(false);
    expect(Rubric.rubricFor(f)).toBe('fico17');
  });
  test('rubricFor is fico17_v6 only for a v6 stamp; isShadow is false without the mark', () => {
    expect(Rubric.rubricFor({ rubric_version: 'fico17_v6' })).toBe('fico17_v6');
    expect(Rubric.rubricFor({ rubric_version: V5 })).toBe('fico17');
    expect(Rubric.rubricFor(null)).toBe('fico17');
    expect(Rubric.isShadow({ rubric_version: V5, visit_context: {} })).toBe(false);
    expect(Rubric.isShadow(null)).toBe(false);
  });
});

describe('runFor on a shadow visit', () => {
  test('ok transcript: the v3 prompt, one model call, the v6 rules; rumi_moments.shadow_v6 per CONTRACTS §8', async () => {
    const f = await visit();
    const llm = jest.fn(() => Promise.resolve(MODEL_V3));
    const labelLlm = jest.fn(() => Promise.resolve(KEEP_ALL));
    const run = await Shadow.runFor(f, OK_T, { llm, labelLlm, lang: 'en' });
    expect(run.started).toBe(true);
    await run.done;
    expect(llm).toHaveBeenCalledTimes(1);
    expect(llm.mock.calls[0][0]).toBe(Moments.buildPrompt(OK_T, f, { lang: 'en', rubric: 'fico17_v6', gaps: '' }));
    expect(labelLlm).toHaveBeenCalledTimes(1);
    const blob = formRow(f.id).rumi_moments.shadow_v6;
    expect(Object.keys(blob).sort()).toEqual(['at', 'counts', 'd2_turns', 'moments', 'prompt_version', 'room_evidence', 'rumi_levels', 'status', 'transcript_quality']);
    expect(blob.d2_turns).toEqual(Moments.d2Turns(OK_T)); // FICO6 r2 (CONTRACTS §11.2)
    expect(blob).toMatchObject({ status: 'ok', prompt_version: 'observe2-moments-v3.1', counts: { closed_q: 3, praise_generic: 1 } });
    expect(blob.moments.map((m) => m.type)).toEqual(['open_q_one', 'reasoning', 'resource_used']); // by group, as v6 stores them
    expect(blob.room_evidence.C3.map((r) => r.id)).toEqual(['room_C3_1']);
    expect(blob.room_evidence.C5[0]).toMatchObject({ kind: 'signal', starts: '12:50' });
    expect(blob.transcript_quality).toEqual(Quality.stored(Quality.assess({ transcript: OK_T, periodMinutes: 40 })));
    expect(blob.rumi_levels).toEqual(Rules.heardLevels(blob.moments, blob.counts, [], { rubric: 'fico17_v6' }));
    expect(Object.keys(blob.rumi_levels)).toHaveLength(17);
    expect(blob.rumi_levels.C8.level).toBe(3); // resource_used: a v6-only rule
    for (const code of COMBINED) {
      expect(blob.rumi_levels[code].level).toBeNull();
      if (code === 'D2') expect(blob.rumi_levels[code]).not.toHaveProperty('dc_result');
      else expect(blob.rumi_levels[code]).toHaveProperty('dc_result');
    }
    expect(Number.isNaN(Date.parse(blob.at))).toBe(false);
  });

  test('the coach\'s own (v5) record is untouched by the shadow write', async () => {
    const f = await visit();
    await Store.setMoments(f.id, { moments: [{ id: 'ask_1' }], prompt_version: 'observe2-moments-v2' }, { C1: { level: 2 } });
    const before = JSON.parse(JSON.stringify(formRow(f.id)));
    await (await Shadow.runFor(formRow(f.id), OK_T, { llm: () => Promise.resolve(MODEL_V3), labelLlm: () => Promise.resolve(KEEP_ALL) })).done;
    const after = formRow(f.id);
    const { shadow_v6: _s, ...rest } = after.rumi_moments;
    expect(rest).toEqual(before.rumi_moments);
    expect(after.rumi_levels).toEqual(before.rumi_levels);
    expect(after.rubric_version).toBe(V5);
  });

  test('partial transcript: the gate\'s gaps go into the v3 prompt', async () => {
    const f = await visit({ transcript: PARTIAL_T });
    const q = Quality.assess({ transcript: PARTIAL_T, periodMinutes: 40 });
    expect(q.status).toBe('partial');
    const llm = jest.fn(() => Promise.resolve(MODEL_V3));
    await (await Shadow.runFor(f, PARTIAL_T, { llm, labelLlm: () => Promise.resolve(KEEP_ALL) })).done;
    expect(llm.mock.calls[0][0]).toContain(Quality.promptGaps(q));
    expect(formRow(f.id).rumi_moments.shadow_v6.transcript_quality.status).toBe('partial');
  });

  test('broken transcript: no model call; every heard row IE, combined dc_result IE', async () => {
    const f = await visit({ transcript: BROKEN_T });
    const llm = jest.fn(() => Promise.resolve(MODEL_V3));
    await (await Shadow.runFor(f, BROKEN_T, { llm })).done;
    expect(llm).not.toHaveBeenCalled();
    const blob = formRow(f.id).rumi_moments.shadow_v6;
    expect(blob).toMatchObject({ status: 'broken', prompt_version: 'observe2-moments-v3.1', moments: [], room_evidence: { C3: [], C5: [], C7: [], D3: [] } });
    expect(blob.transcript_quality.status).toBe('broken');
    for (const [code, row] of Object.entries(blob.rumi_levels)) {
      if (COMBINED.includes(code)) expect(row).toMatchObject({ level: null, ...(code === 'D2' ? {} : { dc_result: 'IE' }) });
      else expect(row).toMatchObject({ level: 'IE', source: 'heard' });
    }
  });

  test('a failed model call writes status failed and never throws', async () => {
    const f = await visit();
    const run = await Shadow.runFor(f, OK_T, { llm: () => Promise.reject(new Error('model down')) });
    await expect(run.done).resolves.toBeDefined();
    const blob = formRow(f.id).rumi_moments.shadow_v6;
    expect(blob).toMatchObject({ status: 'failed', prompt_version: 'observe2-moments-v3.1', error: 'model down' });
    expect(blob.transcript_quality.status).toBe('ok');
    expect(blob).not.toHaveProperty('rumi_levels');
  });

  test('a reply cut off at the output limit is a failure, not an empty lesson', async () => {
    const f = await visit();
    const llm = () => Promise.resolve({ result: { moments: [] }, usage: { completion_tokens: 16000 }, finishReason: 'length' });
    await (await Shadow.runFor(f, OK_T, { llm })).done;
    expect(formRow(f.id).rumi_moments.shadow_v6).toMatchObject({ status: 'failed', error: expect.stringMatching(/cut off/) });
  });

  test('it returns before the model answers: a hung call never holds the caller', async () => {
    const f = await visit();
    const call = held();
    const run = await Shadow.runFor(f, OK_T, { llm: jest.fn(() => call.promise), labelLlm: () => Promise.resolve(KEEP_ALL) });
    expect(run.started).toBe(true);
    expect(formRow(f.id).rumi_moments == null || !formRow(f.id).rumi_moments.shadow_v6).toBe(true);
    call.release();
    await Shadow.idle();
    expect(formRow(f.id).rumi_moments.shadow_v6.status).toBe('ok');
  });
});

describe('runFor on any other visit: no call, no write', () => {
  test('a v5 visit with the switch off', async () => {
    const f = await visit({ swValue: null });
    const llm = jest.fn(() => Promise.resolve(MODEL_V3));
    const run = await Shadow.runFor(f, OK_T, { llm });
    expect(run.started).toBe(false);
    expect(llm).not.toHaveBeenCalled();
    expect(mockFake.__calls.filter((c) => c.action === 'update' && c.values && 'rumi_moments' in c.values)).toHaveLength(0);
  });
  test('a v6 visit (v6 is not shadow)', async () => {
    const f = await visit({ swValue: 'v6' });
    expect(f.rubric_version).toBe('fico17_v6');
    const llm = jest.fn(() => Promise.resolve(MODEL_V3));
    expect((await Shadow.runFor(f, OK_T, { llm })).started).toBe(false);
    expect(llm).not.toHaveBeenCalled();
  });
  test('no form', async () => {
    expect((await Shadow.runFor(null, OK_T, {})).started).toBe(false);
  });
});

describe('the moments job on a shadow visit (the hook in moments.js)', () => {
  const twoReads = (v3) => jest.fn((prompt) => (isV3(prompt) ? v3() : Promise.resolve(MODEL_V2)));

  test('the coach gets the v5 moments and the check; the v6 read is stored beside them', async () => {
    const f = await visit();
    const llm = twoReads(() => Promise.resolve(MODEL_V3));
    const out = await Moments.runForSession('sess-1', '923000000001', { llm, labelLlm: jest.fn(() => Promise.resolve(KEEP_ALL)) });
    expect(out).toMatchObject({ handled: true, action: 'check_sent' });
    await Shadow.idle();
    expect(llm.mock.calls.map(([p]) => (isV3(p) ? 'v3' : 'v2'))).toEqual(['v2', 'v3']);
    const r = formRow(f.id);
    expect(r.rumi_moments.prompt_version).toBe('observe2-moments-v2');
    expect(r.rumi_moments.moments.map((m) => m.type)).toEqual(['open_q_one']);
    expect(r.rumi_moments).not.toHaveProperty('room_evidence');
    expect(r.rumi_moments).not.toHaveProperty('transcript_quality');
    expect(r.rumi_levels).toEqual(Rules.heardLevels(r.rumi_moments.moments, r.rumi_moments.counts));
    expect(r.rumi_moments.shadow_v6).toMatchObject({ status: 'ok', prompt_version: 'observe2-moments-v3.1' });
    // Nothing v6 reaches the coach: one check Flow, and no other message.
    expect(WhatsAppService.sendFlow).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
  });

  test('a hung v6 read does not hold up the check', async () => {
    const f = await visit();
    const call = held();
    const llm = twoReads(() => call.promise);
    const out = await Moments.runForSession('sess-1', '923000000001', { llm, labelLlm: jest.fn(() => Promise.resolve(KEEP_ALL)) });
    expect(out).toMatchObject({ handled: true, action: 'check_sent' });
    expect(mockFake.__tables.coaching_sessions[0].status).toBe('observe2_checking');
    expect(formRow(f.id).rumi_moments).not.toHaveProperty('shadow_v6');
    call.release();
    await Shadow.idle();
    expect(formRow(f.id).rumi_moments.shadow_v6.status).toBe('ok');
  });

  test('a failed v6 read never fails the moments: the check is sent, the shadow says failed', async () => {
    const f = await visit();
    const llm = twoReads(() => Promise.reject(new Error('model down')));
    const out = await Moments.runForSession('sess-1', '923000000001', { llm, labelLlm: jest.fn(() => Promise.resolve(KEEP_ALL)) });
    expect(out).toMatchObject({ handled: true, action: 'check_sent' });
    await Shadow.idle();
    expect(formRow(f.id).rumi_moments.shadow_v6.status).toBe('failed');
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
  });

  test('a v5 visit with the switch off: one read, no shadow', async () => {
    const f = await visit({ swValue: null });
    const llm = twoReads(() => Promise.resolve(MODEL_V3));
    await Moments.runForSession('sess-1', '923000000001', { llm, labelLlm: jest.fn(() => Promise.resolve(KEEP_ALL)) });
    await Shadow.idle();
    expect(llm).toHaveBeenCalledTimes(1);
    expect(formRow(f.id).rumi_moments).not.toHaveProperty('shadow_v6');
  });
});

describe('the coach\'s check on a shadow visit is v5 (no COMBINED screens)', () => {
  const token = (id) => `coach-1:observe2-check:${id}`;
  const ex = (id, screen, data) => Check.handleObserve2CheckDataExchange(token(id), screen, { screen, ...data });
  const heard = (screen, answers = {}, extra = {}) => {
    const out = { screen, ...extra };
    for (let i = 1; i <= 8; i += 1) out[`${screen.toLowerCase()}_${i}`] = answers[i] || '';
    return out;
  };
  const ANSWERS = {
    present: '32', p1_spoke: '6', p1_picked: 'once', p1_groups: 'alone', p1_listen: ['turns'], p1_materials: 'teacher', p1_change: 'yes', p1_change_how: 'slow',
    p2_spoke: '10', p2_new: '5', p2_picked: 'often', p2_groups: 'combine', p2_listen: ['once'], p2_materials: 'children', p2_change: 'no',
    incident: 'none', lp: 'used', priority: 'C8',
  };

  test('the new Flow (v6 marker sent) still routes the moments to ADDED_ONE, and Submit keeps the v5 record', async () => {
    const f = await visit({
      patch: {
        answers: ANSWERS, part1_done_at: 'x', part2_done_at: 'x', moments_ready_at: '2026-11-11T05:50:00.000Z',
        rumi_moments: { moments: MODEL_V2.moments.map((m, i) => ({ id: `ask_${i + 1}`, ...m, label: 'open question' })), counts: MODEL_V2.counts, shadow_v6: { status: 'ok' } },
        rumi_levels: { C1: { level: 2 } },
      },
    });
    mockFake.__tables.coaching_sessions[0].status = 'observe2_checking';
    await ex(f.id, 'HEARD_ASK', heard('HEARD_ASK', { 1: 'yes' }));
    await ex(f.id, 'HEARD_WRONG', heard('HEARD_WRONG'));
    await ex(f.id, 'HEARD_WORK', heard('HEARD_WORK'));
    const a1 = await ex(f.id, 'HEARD_EXPLAIN', heard('HEARD_EXPLAIN', {}, { v6c: '1' }));
    expect(a1.screen).toBe('ADDED_ONE');
    expect(JSON.stringify(a1.data)).not.toMatch(/_ev"|cmb_/);
    const a2 = await ex(f.id, 'ADDED_ONE', { C1_final: '2', C2_final: '1', C3_final: '3', C6_final: '2', D1_final: '2', D2_final: '4', D4_final: 'IE', D5_final: '1' });
    expect(a2.screen).toBe('ADDED_TWO');
    const pr = await ex(f.id, 'ADDED_TWO', { C4_final: '1', C5_final: '2', C7_final: '3', C8_final: '3', D3_final: '2', F1_final: '3', F2_final: '2', F3_final: '2', F4_final: '1' });
    expect(pr.screen).toBe('PRIORITY');
    const done = await ex(f.id, 'PRIORITY', { priority_final: 'C8', why: '' });
    expect(done.screen).toBe('DONE');
    const r = formRow(f.id);
    expect(r.final_levels).toMatchObject({ C1: '2', C3: '3', C8: '3' });
    expect(r.evidence_review).not.toHaveProperty('v6_levels');
    expect(r.evidence_review).not.toHaveProperty('v6_fallback');
    expect(r.rumi_moments.shadow_v6).toEqual({ status: 'ok' });
  });
});
