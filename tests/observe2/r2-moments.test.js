/**
 * FICO6 r2 fix-moments (bd-qix9oh, PLAN §7, CONTRACTS §11.2).
 *
 * T6.1 (redteam): the plan graded at the seal rewrote rumi_moments whole from a stale read, so a shadow_v6 stored
 * by the background v6 read in between was lost. Fixed at both ends: gradeAtSeal re-reads just before its write,
 * and Store.setRumiMoments keeps the v6 keys a patch does not carry.
 * D2 turns: the moments job counts the Student lines in each half of the lesson (spec §5.6) and stores
 * rumi_moments.d2_turns on v6 visits, shadow_v6.d2_turns on shadow visits, nothing on v5 visits.
 *
 * Real: moments, shadow-v6, the store, quote and label checks, rules, the gate. Mocked at the boundary: the
 * database (fake-supabase), WhatsApp, the logger, the model, the fidelity grader. Synthetic data only.
 */
const { createFakeSupabase } = require('./helpers/fake-supabase');

let mockFake;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendFlow: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/observe/observe-debrief.service', () => ({ displayTimeZone: () => 'Asia/Karachi' }));

const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const Moments = require('../../bot/shared/services/observe/observe2/moments');
const Shadow = require('../../bot/shared/services/observe/observe2/shadow-v6');
const Switch = require('../../bot/shared/services/coaching/fico-rubric-switch');

const V5 = 'fico-ict-17-2026-09';
const QUALITY = { status: 'partial', coverage: 0.6, issues: [{ type: 'short', from: '24:00' }] };
const SHADOW_V6 = { prompt_version: 'observe2-moments-v3', status: 'ok', moments: [], counts: {}, rumi_levels: { C1: { level: 2 } }, transcript_quality: QUALITY, at: '2026-11-11T06:00:00.000Z' };

const formRow = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);

beforeEach(() => {
  jest.clearAllMocks();
  mockFake = createFakeSupabase({
    users: [
      { id: 'coach-1', phone_number: '923000000001', name: 'Coach', preferred_language: 'en', role: 'coach', region: 'Sihala' },
      { id: 'teacher-1', phone_number: '923000000002', name: 'Teacher', preferred_language: 'en', role: 'teacher', teacher_level: ['PRIMARY'] },
    ],
  });
  Switch._resetCache();
  process.env.OBSERVE2_CHECK_FLOW_ID = 'F-CHECK';
});
afterAll(() => { delete process.env.OBSERVE2_CHECK_FLOW_ID; });

// ---------------------------------------------------------------- T6.1 (copied from redteam t6-rewriters.test.js)
describe('T6.1 gradeAtSeal keeps a shadow_v6 stored while the plan is graded', () => {
  async function shadowVisitAwaitingSeal() {
    const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: { shadow_v6: true } });
    Object.assign(formRow(form.id), {
      period_minutes: 40, rubric_version: V5, visit_context: { shadow_v6: true },
      coaching_session_id: 'sess-1', moments_ready_at: '2026-11-11T05:50:00.000Z', sealed_at: '2026-11-11T05:55:00.000Z',
      answers: { lp: 'used', lp_ref: { lesson_id: 'grade_4_math_ch5_seg3', version_stamp: 'v', content_hash: 'h' }, incident: 'none', priority: 'C1' },
      rumi_moments: { moments: [], counts: {}, prompt_version: 'observe2-moments-v2', fidelity: null, fidelity_at_seal: true },
    });
    mockFake.__tables.coaching_sessions = [{ id: 'sess-1', status: 'observe2_ready', transcript_text: '[00:10] Teacher: hello', audio_duration_seconds: 2400 }];
    return form.id;
  }

  async function sealWhile(id, during) {
    process.env.LP_FIDELITY_ENABLED = 'true';
    const F = require('../../bot/shared/services/coaching/fidelity/fidelity-orchestrator');
    let graded = 0;
    const spy = jest.spyOn(F, 'computeLpFidelity').mockImplementation(async () => {
      graded += 1;
      await during();
      return { status: 'ok', fidelity_pct: 50, moves: [] };
    });
    try {
      await Moments.onSealed(formRow(id), {});
    } finally {
      spy.mockRestore();
      delete process.env.LP_FIDELITY_ENABLED;
    }
    return graded;
  }

  test('control: a shadow_v6 stored BEFORE the seal survives the seal-time grading', async () => {
    const id = await shadowVisitAwaitingSeal();
    await Store.setShadowV6(id, SHADOW_V6);
    await Moments.onSealed(formRow(id), {});
    expect(formRow(id).rumi_moments.shadow_v6).toEqual(SHADOW_V6);
  });

  test('a shadow_v6 stored WHILE the plan is being graded is still there after the seal-time write', async () => {
    const id = await shadowVisitAwaitingSeal();
    const graded = await sealWhile(id, () => Store.setShadowV6(id, SHADOW_V6));
    expect(graded).toBe(1);
    expect(formRow(id).rumi_moments.fidelity).toMatchObject({ status: 'ok' });
    expect(formRow(id).rumi_moments).not.toHaveProperty('fidelity_at_seal');
    expect(formRow(id).rumi_moments.shadow_v6).toEqual(SHADOW_V6);
  });

  test('a v5 visit: the seal-time write is byte-identical to before (moments, counts, version, fidelity)', async () => {
    const id = await shadowVisitAwaitingSeal();
    Object.assign(formRow(id), { visit_context: {} });
    await sealWhile(id, async () => {});
    expect(formRow(id).rumi_moments).toEqual({
      moments: [], counts: {}, prompt_version: 'observe2-moments-v2',
      fidelity: { status: 'ok', fidelity_pct: 50, moves: [], graded_at: expect.any(String) },
    });
  });
});

// ---------------------------------------------------------------- Store.setRumiMoments merge (CONTRACTS §11.2)
describe('Store.setRumiMoments keeps the v6 keys a patch does not carry', () => {
  const KEPT = { shadow_v6: SHADOW_V6, transcript_quality: QUALITY, room_evidence: { C3: [], C5: [], C7: [], D3: [] }, d2_turns: { first_half: 3, second_half: 2 } };

  async function formWith(rumiMoments) {
    const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1' });
    formRow(form.id).rumi_moments = rumiMoments;
    return form.id;
  }

  test('a patch without them: the stored ones stay', async () => {
    const id = await formWith({ moments: [{ id: 'ask_1' }], fidelity_at_seal: true, ...KEPT });
    const out = await Store.setRumiMoments(id, { moments: [{ id: 'ask_1' }], fidelity: { status: 'ok' } });
    expect(out.ok).toBe(true);
    expect(formRow(id).rumi_moments).toEqual({ moments: [{ id: 'ask_1' }], fidelity: { status: 'ok' }, ...KEPT });
  });

  test('a patch that carries them wins', async () => {
    const id = await formWith({ moments: [], ...KEPT });
    const fresh = { shadow_v6: { status: 'failed' }, transcript_quality: { status: 'ok', coverage: 1, issues: [] }, room_evidence: { C3: [{ id: 'room_C3_1' }] }, d2_turns: { first_half: 9, second_half: 9 } };
    await Store.setRumiMoments(id, { moments: [], ...fresh });
    expect(formRow(id).rumi_moments).toEqual({ moments: [], ...fresh });
  });

  test('any other key is still replaced whole (fidelity_at_seal is dropped when the patch leaves it out)', async () => {
    const id = await formWith({ moments: [{ id: 'ask_1' }], verified: { kept: 1 }, fidelity_at_seal: true });
    await Store.setRumiMoments(id, { moments: [], fidelity: null });
    expect(formRow(id).rumi_moments).toEqual({ moments: [], fidelity: null });
  });

  test('a v5 record (none of the keys): written exactly as given', async () => {
    const id = await formWith({ moments: [{ id: 'ask_1' }], counts: { closed_q: 1 }, prompt_version: 'observe2-moments-v2', fidelity_at_seal: true });
    const patch = { moments: [{ id: 'ask_1' }], counts: { closed_q: 1 }, prompt_version: 'observe2-moments-v2', fidelity: { status: 'ok' } };
    await Store.setRumiMoments(id, patch);
    expect(formRow(id).rumi_moments).toEqual(patch);
  });

  test('a read error is returned, nothing written', async () => {
    const id = await formWith({ moments: [], ...KEPT });
    mockFake.__failNext({ message: 'read down' });
    const out = await Store.setRumiMoments(id, { moments: [] });
    expect(out).toMatchObject({ ok: false, error: 'read down' });
    expect(formRow(id).rumi_moments).toEqual({ moments: [], ...KEPT });
  });
});

// ---------------------------------------------------------------- D2 turns (spec §5.6, Appendix C, CONTRACTS §11.2)
describe('d2Turns: Student lines in each half, split at the midpoint of the first and last timestamp', () => {
  const T = [
    '[00:10] Teacher (UR): آج ہم کسر پڑھیں گے۔',
    '[00:15] Student (UR): پانچ۔',
    '[10:00] Student (UR): جی۔',
    '[20:05] Students (UR): ہاں جی۔', // after the midpoint (20:05 > 20:00)
    '[20:00] Student (UR): دس۔', // out of order, exactly at the midpoint: first half
    '[30:00] Teacher (UR): ٹھیک ہے۔',
    '[39:50] Student (UR): شکریہ۔',
  ].join('\n\n');

  test('counts and split', () => {
    expect(Moments.d2Turns(T)).toEqual({ first_half: 3, second_half: 2 });
  });
  test('no Student line: zeros', () => {
    expect(Moments.d2Turns('[00:10] Teacher (EN): hello\n[10:00] Teacher (EN): bye')).toEqual({ first_half: 0, second_half: 0 });
  });
  test('no timestamps: null', () => {
    expect(Moments.d2Turns('Teacher: hello\nStudent: hi')).toBeNull();
  });
  test('an untimed line inside a timed transcript is not counted', () => {
    expect(Moments.d2Turns('[00:00] Student (EN): a\nStudent (EN): b\n[10:00] Student (EN): c')).toEqual({ first_half: 1, second_half: 1 });
  });
});

describe('the moments job stores d2_turns on v6 and shadow visits, never on v5', () => {
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
  // midpoint (00:30 + 39:00) / 2 = 19:45: Student lines at 00:45, 07:50, 10:00 | 30:00, 35:00
  const TURNS = { first_half: 3, second_half: 2 };
  const MODEL_V3 = {
    moments: [{ moment: 'ask', type: 'open_q_one', minute: '00:30', quote: 'Ali, what do you think a plant needs to grow? — I think it needs water and sunlight.', why: 'An open question a child answered.' }],
    counts: { closed_q: 1, praise_generic: 0 },
    room: [],
  };
  const MODEL_V2 = { moments: MODEL_V3.moments, counts: { closed_q: 1, praise_generic: 0 } };
  const KEEP_ALL = { verdicts: [{ n: 1, verdict: 'keep' }] };
  const isV3 = (p) => /ROOM EVIDENCE/.test(p);
  const llm = jest.fn((p) => Promise.resolve(isV3(p) ? MODEL_V3 : MODEL_V2));

  async function visit(swValue) {
    mockFake.__tables.app_settings = swValue == null ? [] : [{ key: 'fico_coach_rubric', value: swValue }];
    Switch._resetCache();
    const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: {} });
    Object.assign(formRow(form.id), { period_minutes: 40, sealed_at: '2026-11-11T05:39:00.000Z' });
    mockFake.__tables.coaching_sessions = [{ id: 'sess-1', status: 'transcription_complete', transcript_text: OK_T, observation_type: 'leader_observation', observer_user_id: 'coach-1', user_id: 'teacher-1' }];
    await Store.linkSession(form.id, 'sess-1');
    return formRow(form.id);
  }

  test('v6 visit: rumi_moments.d2_turns', async () => {
    const f = await visit('v6');
    expect(f.rubric_version).toBe('fico17_v6');
    await Moments.runForSession('sess-1', '923000000001', { llm, labelLlm: () => Promise.resolve(KEEP_ALL) });
    expect(formRow(f.id).rumi_moments.d2_turns).toEqual(TURNS);
  });

  test('v6 visit, broken transcript: d2_turns still stored (it is a count, not a level)', async () => {
    const f = await visit('v6');
    const loop = ['[00:30] Teacher (UR): آج ہم پودوں کے بارے میں پڑھیں گے۔',
      ...Array.from({ length: 76 }, (_, i) => { const s = 120 + i * 30; return `[${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}] Student (UR): ٹھیک ٹھیک ٹھیک`; })].join('\n\n');
    mockFake.__tables.coaching_sessions[0].transcript_text = loop;
    await Moments.runForSession('sess-1', '923000000001', { llm, labelLlm: () => Promise.resolve(KEEP_ALL) });
    expect(llm).not.toHaveBeenCalled();
    expect(formRow(f.id).rumi_moments.transcript_quality.status).toBe('broken');
    expect(formRow(f.id).rumi_moments.d2_turns).toEqual(Moments.d2Turns(loop));
  });

  test('shadow visit: shadow_v6.d2_turns; the coach\'s v5 record has none', async () => {
    const f = await visit('shadow');
    await Moments.runForSession('sess-1', '923000000001', { llm, labelLlm: () => Promise.resolve(KEEP_ALL) });
    await Shadow.idle();
    const r = formRow(f.id).rumi_moments;
    expect(r.shadow_v6).toMatchObject({ status: 'ok', d2_turns: TURNS });
    expect(r).not.toHaveProperty('d2_turns');
  });

  test('v5 visit: no d2_turns, rumi_moments keys and values exactly as before', async () => {
    const f = await visit(null);
    await Moments.runForSession('sess-1', '923000000001', { llm, labelLlm: () => Promise.resolve(KEEP_ALL) });
    const r = formRow(f.id).rumi_moments;
    expect(Object.keys(r).sort()).toEqual(['counts', 'fidelity', 'moments', 'prompt_version', 'verified']);
    expect(r).toMatchObject({ prompt_version: 'observe2-moments-v2', counts: { closed_q: 1, praise_generic: 0 }, fidelity: null });
    expect(r.moments.map((m) => m.id)).toEqual(['ask_1']);
  });
});
