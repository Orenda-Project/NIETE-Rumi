/**
 * /observe2 — record each lesson first, fill its form afterwards (pilot sheet R19, 14 Oct 2026).
 *
 * The ICT lead: with consecutive observations, coaches want to record each class, then fill the forms,
 * then debrief, then send. Production, 5-15 Oct: 36 recordings from /observe2 coaches arrived with no
 * form waiting; not one reached an /observe2 form without being sent again (20 became classic
 * /observe observations from the "whose observation is this?" list, 14 were sent again, 2 were lost).
 * A form opened after its recording never found it: the link is made only at capture.
 *
 * Now a lesson-length recording from a coach whose latest observation was an /observe2 one is held at
 * once as an /observe2 visit (its own field form, in the database), the coach names the teacher on the
 * "who did you observe?" list, and the form can be filled whenever they are ready, from the saved
 * message or the "Complete the form" worklist, in an "after the lesson" mode with no clock wording.
 *
 * Real: the audio router, the capture, the /observe2 link and store, the who-question, the worklist,
 * resume, the visit Flow's worklist screen, the form endpoint and start. Mocked at the boundary: the
 * database (in-memory), WhatsApp, Redis (observe state and cache), the job queue, the coach's roster.
 */
const { createFakeSupabase } = require('./helpers/fake-supabase');

let mockDb;
const mockRedis = new Map();
const mockRoster = [
  { teacher_ext_id: '920000000101', teacher_name: 'Test Teacher Amna', phone_e164: '920000000101', user_id: 'teacher-a' },
  { teacher_ext_id: '920000000102', teacher_name: 'Test Teacher Bilal', phone_e164: '920000000102', user_id: 'teacher-b' },
];

jest.mock('../../bot/shared/config/supabase', () => ({ from: (t) => mockDb.from(t) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendInteractiveButtons: jest.fn(() => Promise.resolve(true)),
  sendInteractiveMessage: jest.fn(() => Promise.resolve(true)),
  sendFlow: jest.fn(() => Promise.resolve(true)),
  getMediaInfo: jest.fn(() => Promise.resolve({})),
}));
jest.mock('../../bot/shared/services/observe/observe-state.service', () => ({
  getState: jest.fn(() => Promise.resolve(null)),
  setState: jest.fn(() => Promise.resolve(true)),
  clearState: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({
  queueTranscription: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => {
  const read = (k) => {
    if (!mockRedis.has(k)) return null;
    const v = mockRedis.get(k);
    try { return JSON.parse(v); } catch (_) { return v; }
  };
  return {
    get: jest.fn((k) => Promise.resolve(read(k))),
    setexWithCeiling: jest.fn((k, ttl, v) => { mockRedis.set(k, typeof v === 'string' ? v : JSON.stringify(v)); return Promise.resolve(true); }),
    delete: jest.fn((k) => { mockRedis.delete(k); return Promise.resolve(true); }),
    setNX: jest.fn((k, v) => { if (mockRedis.has(k)) return Promise.resolve(false); mockRedis.set(k, v); return Promise.resolve(true); }),
  };
});
jest.mock('../../bot/shared/services/observe/assignment/leader-source', () => ({
  listTeachers: jest.fn(() => Promise.resolve(mockRoster)),
}));
jest.mock('../../bot/shared/services/observe/patch-resolver.service', () => ({
  listPatchViaSupabase: jest.fn(() => Promise.resolve([])),
  displayNameOf: (u) => (u && u.name) || null,
}));
jest.mock('../../bot/shared/services/observe/observe-schedule.service', () => ({
  markDone: jest.fn(() => Promise.resolve(true)),
  listUpcoming: jest.fn(() => Promise.resolve([])),
  countUpcoming: jest.fn(() => Promise.resolve(0)),
}));

process.env.OBSERVE_MEWAKA_FLOW_ID = process.env.OBSERVE_MEWAKA_FLOW_ID || 'F-FICO';
process.env.OBSERVE2_FIELD_FORM_FLOW_ID = 'field-flow';
process.env.OBSERVE2_CHECK_FLOW_ID = 'check-flow';
process.env.OBSERVE_VISIT_FLOW_ID = 'visit-flow';

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const ObserveBinding = require('../../bot/shared/services/observe/observe-binding.service');
const ObserveWho = require('../../bot/shared/services/observe/observe-who.service');
const Debrief = require('../../bot/shared/services/observe/observe-debrief.service');
const Resume = require('../../bot/shared/services/observe/observe-resume.service');
const VisitHandler = require('../../bot/shared/handlers/observe-visit-flow.handler');
const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const Start = require('../../bot/shared/services/observe/observe2/start');
const Endpoint = require('../../bot/shared/routes/observe2-form-endpoint');
const { routeLeaderAudio } = require('../../bot/shared/services/observe/observe-audio-router');
const { observe2Strings } = require('../../bot/shared/services/observe/observe2/strings');
const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');

const COACH = { id: 'coach-1', role: 'coach', preferred_language: 'en', phone_number: '920000000001' };
const FROM = COACH.phone_number;
const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();

// The coach's history decides the flow: their latest observation.
const O2_HISTORY = {
  coaching_sessions: [{ id: 'prev-o2', observer_user_id: 'coach-1', user_id: 'teacher-z', observation_type: 'leader_observation', status: 'completed', debrief_status: 'done', created_at: hoursAgo(20), updated_at: hoursAgo(19) }],
  observation_field_forms: [{ id: 'prev-form', observer_user_id: 'coach-1', teacher_user_id: 'teacher-z', coaching_session_id: 'prev-o2', visit_context: {}, answers: {}, photos: [], evidence_review: {}, period_minutes: 35, sealed_at: hoursAgo(20.1), checked_at: hoursAgo(19), created_at: hoursAgo(20.5) }],
};
const CLASSIC_SINCE = { id: 'later-classic', observer_user_id: 'coach-1', user_id: 'teacher-y', observation_type: 'leader_observation', status: 'completed', debrief_status: 'done', created_at: hoursAgo(3), updated_at: hoursAgo(2) };

function seed({ classicSince = false, forms = [], sessions = [] } = {}) {
  mockDb = createFakeSupabase({
    users: [COACH, { id: 'teacher-a', name: 'Test Teacher Amna', phone_number: '920000000101', role: 'teacher' }],
    coaching_sessions: [...O2_HISTORY.coaching_sessions, ...(classicSince ? [CLASSIC_SINCE] : []), ...sessions],
    observation_field_forms: [...O2_HISTORY.observation_field_forms, ...forms],
    observation_schedules: [],
  });
}

const send = (over = {}) => routeLeaderAudio({
  user: COACH, from: FROM, audioId: 'audio-1', sessionId: 'chat-1', durationSeconds: 2049, sha256: 'sha-1', ...over,
});
const newForms = () => mockDb.__tables.observation_field_forms.filter((f) => !f.id.startsWith('prev'));
const newSessions = () => mockDb.__tables.coaching_sessions.filter((s) => !['prev-o2', 'later-classic'].includes(s.id) && !s.id.startsWith('seed'));
const S2 = observe2Strings('en');

beforeEach(() => {
  jest.clearAllMocks();
  mockRedis.clear();
  seed();
});

describe('a recording that arrives with no form waiting', () => {
  test('is held as an /observe2 visit: its own field form, linked, in the database, not the "whose observation?" park', async () => {
    const park = jest.spyOn(ObserveBinding, 'parkAndAsk');
    expect(await send()).toBe(true);
    expect(park).not.toHaveBeenCalled();
    expect(newSessions()).toHaveLength(1);
    expect(newForms()).toHaveLength(1);
    const [form] = newForms();
    expect(form).toMatchObject({ observer_user_id: 'coach-1', teacher_user_id: null, coaching_session_id: newSessions()[0].id });
    expect(form.visit_context.recorded_first).toBe(true);
    // The lesson's own length is the period: 2049 s → 34 minutes, so the halfway minute is the recording's.
    expect(form.period_minutes).toBe(34);
    expect(newSessions()[0]).toMatchObject({ observation_type: 'leader_observation', observer_user_id: 'coach-1', audio_id: 'audio-1', status: 'confirmed' });
  });

  test('the coach is told it is saved, with a button to fill the form now, and a way out', async () => {
    await send();
    const [form] = newForms();
    const ack = WhatsAppService.sendInteractiveButtons.mock.calls[0][1];
    expect(ack.body).toBe(S2.held_saved(34));
    expect(ack.buttons.map((b) => b.id)).toEqual([`obs2_fill:${form.id}`, `observe_cancel_${newSessions()[0].id}`]);
    for (const b of ack.buttons) expect([...b.title].length).toBeLessThanOrEqual(20);
  });

  test('then "whose lesson is this?" with the coach\'s roster, tied to this recording', async () => {
    await send();
    const list = WhatsAppService.sendInteractiveMessage.mock.calls.map((c) => c[1]).find((p) => p.body === observeStrings('en').who_body);
    expect(list).toBeDefined();
    const ids = list.action.sections[0].rows.map((r) => r.id);
    expect(ids[0]).toBe(`observe_who_${newSessions()[0].id}_0`);
  });

  test('two recordings back to back: each is held separately, each with its own question', async () => {
    await send();
    await send({ audioId: 'audio-2', sha256: 'sha-2', durationSeconds: 1980 });
    expect(newSessions()).toHaveLength(2);
    expect(newForms()).toHaveLength(2);
    const [f1, f2] = newForms();
    expect(f1.coaching_session_id).toBe(newSessions()[0].id);
    expect(f2.coaching_session_id).toBe(newSessions()[1].id);
    const asked = WhatsAppService.sendInteractiveMessage.mock.calls.map((c) => c[1].action.sections[0].rows[0].id);
    expect(asked).toEqual([`observe_who_${newSessions()[0].id}_0`, `observe_who_${newSessions()[1].id}_0`]);
  });

  test('the same file sent again is answered as already saved: no second visit', async () => {
    await send();
    WhatsAppService.sendMessage.mockClear();
    await send({ audioId: 'audio-1-again' });
    expect(newSessions()).toHaveLength(1);
    expect(newForms()).toHaveLength(1);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendMessage.mock.calls[0][1]).toContain(observeStrings('en').bind_dupe_ack.split('{name}')[0].slice(0, 12));
  });

  test('a coach whose latest observation was classic /observe keeps today\'s "whose observation?" list', async () => {
    seed({ classicSince: true });
    const park = jest.spyOn(ObserveBinding, 'parkAndAsk').mockResolvedValue({ action: 'asked' });
    expect(await send()).toBe(true);
    expect(park).toHaveBeenCalled();
    expect(newForms()).toHaveLength(0);
    expect(newSessions()).toHaveLength(0);
  });

  test('a coach who has never used /observe2 keeps today\'s list', async () => {
    mockDb = createFakeSupabase({ coaching_sessions: [CLASSIC_SINCE], observation_field_forms: [], observation_schedules: [] });
    const park = jest.spyOn(ObserveBinding, 'parkAndAsk').mockResolvedValue({ action: 'asked' });
    await send();
    expect(park).toHaveBeenCalled();
  });

  test('when the history cannot be read, today\'s list applies (never a guess)', async () => {
    const park = jest.spyOn(ObserveBinding, 'parkAndAsk').mockResolvedValue({ action: 'asked' });
    // 1st read: the waiting-form lookup (succeeds); 2nd read: the coach's latest form (fails).
    const realFrom = mockDb.from;
    let reads = 0;
    mockDb.from = (t) => {
      if (t === 'observation_field_forms' && ++reads === 2) mockDb.__failNext({ message: 'connection reset' });
      return realFrom(t);
    };
    await send();
    expect(park).toHaveBeenCalled();
  });

  test('a short voice note with nothing armed is still the coach talking to Rumi', async () => {
    expect(await send({ durationSeconds: 45 })).toBe(false);
    expect(newForms()).toHaveLength(0);
  });

  test('a held recording refused as already analysed does not tell the coach its form "waits for a recording"', async () => {
    await send();
    const { releaseRefusedRecording } = require('../../bot/shared/services/observe/observe2/capture-link');
    const out = await releaseRefusedRecording(newSessions()[0].id);
    expect(out.released).toBe(false);
    expect(newForms()[0].coaching_session_id).toBe(null);
  });

  test('a held form never takes another recording, even after losing its own', async () => {
    await send();
    const [held] = newForms();
    held.coaching_session_id = null; // e.g. refused as a duplicate by the worker and released
    const found = await Store.findOpenFormForCapture('coach-1');
    expect(found.ok).toBe(true);
    expect(found.form).toBe(null);
  });
});

describe('naming the teacher after the recording', () => {
  async function pick(index = 0) {
    await send();
    const sessionId = newSessions()[0].id;
    await ObserveWho.handleObservedTeacherPick(COACH, FROM, `observe_who_${sessionId}_${index}`);
    return sessionId;
  }

  test('the pick names the teacher on the held form and makes the teacher the observation\'s owner', async () => {
    const sessionId = await pick(0);
    const [form] = newForms();
    expect(form.teacher_user_id).toBe('teacher-a');
    expect(form.visit_context).toMatchObject({ recorded_first: true, teacher_ext_id: '920000000101' });
    expect(mockDb.__tables.coaching_sessions.find((s) => s.id === sessionId).user_id).toBe('teacher-a');
    expect(mockDb.__tables.observation_schedules).toHaveLength(1);
  });

  test('a form that already names its teacher is never renamed by a later answer', async () => {
    await pick(0);
    const sessionId = newSessions()[0].id;
    await ObserveWho.handleObservedTeacherPick(COACH, FROM, `observe_who_${sessionId}_1`);
    expect(newForms()[0].teacher_user_id).toBe('teacher-a');
    expect(mockDb.__tables.coaching_sessions.find((s) => s.id === sessionId).user_id).toBe('teacher-a');
  });
});

describe('filling the form later', () => {
  test('"Fill the form" sends the live form in its after-the-lesson words', async () => {
    await send();
    const [form] = newForms();
    expect(await Start.handleFillButton(COACH, FROM, `obs2_fill:${form.id}`)).toBe(true);
    expect(WhatsAppService.sendFlow).toHaveBeenCalledTimes(1);
    const flow = WhatsAppService.sendFlow.mock.calls[0][1];
    expect(flow).toMatchObject({ flowId: 'field-flow', flowToken: `coach-1:observe2-form:${form.id}`, body: S2.form_body_after });
    expect(flow.body).not.toMatch(/minute|start recording|Before the lesson/i);
  });

  test('"Fill the form" on a sealed form, or another coach\'s, opens nothing', async () => {
    await send();
    const [form] = newForms();
    form.sealed_at = new Date().toISOString();
    await Start.handleFillButton(COACH, FROM, `obs2_fill:${form.id}`);
    await Start.handleFillButton({ ...COACH, id: 'coach-2' }, FROM, `obs2_fill:${newForms()[0].id}`);
    expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(FROM, S2.form_gone);
  });

  test('anything that is not a fill button is not claimed', async () => {
    expect(await Start.handleFillButton(COACH, FROM, 'obs2_period:abc:30')).toBe(false);
  });

  // The webhook cannot be driven here; the repo checks its button branch the same way for obs2_period:
  // (command-dispatch.test.js). handleFillButton itself runs for real above.
  test('the webhook\'s button_reply branch hands obs2_fill: taps to handleFillButton', () => {
    const fs = require('fs');
    const path = require('path');
    const bot = fs.readFileSync(process.env.WHATSAPP_BOT_SRC || path.join(__dirname, '../../bot/whatsapp-bot.js'), 'utf8');
    const branch = bot.split("interactive?.type === 'button_reply'")[1].split("interactive?.type === 'list_reply'")[0];
    const code = branch.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    const at = code.indexOf("buttonId.startsWith('obs2_fill:')");
    expect(at).toBeGreaterThan(0);
    expect(code.slice(at, at + 400)).toMatch(/Observe2Start\.handleFillButton\(user, from, buttonId\)/);
  });
});

describe('the "Complete the form" worklist', () => {
  test('a held recording is listed, by teacher, as a recorded lesson whose form is still to fill', async () => {
    await send();
    const sessionId = newSessions()[0].id;
    await ObserveWho.handleObservedTeacherPick(COACH, FROM, `observe_who_${sessionId}_0`);
    const s = mockDb.__tables.coaching_sessions.find((r) => r.id === sessionId);
    s.status = 'observe2_ready';
    const list = await Debrief.listUnfinished('coach-1');
    expect(list.map((r) => [r.id, r.resume, r.teacher_name])).toEqual([[sessionId, 'observe2_form', 'Test Teacher Amna']]);
  });

  test('it is listed while Rumi is still reading the recording, too', async () => {
    await send();
    newSessions()[0].status = 'observe2_moments';
    const list = await Debrief.listUnfinished('coach-1');
    expect(list.map((r) => r.resume)).toEqual(['observe2_form']);
  });

  test('a sealed visit waiting for its check keeps its own row text', async () => {
    await send();
    newSessions()[0].status = 'observe2_ready';
    newForms()[0].sealed_at = new Date().toISOString();
    const list = await Debrief.listUnfinished('coach-1');
    expect(list.map((r) => r.resume)).toEqual(['observe2']);
  });

  test.each(['en', 'ur', 'sw'])('the chat list row says so, within WhatsApp\'s 72 code points (%s)', (lang) => {
    const S = observeStrings(lang);
    expect(typeof S.resume_desc_observe2_form).toBe('string');
    expect([...S.resume_desc_observe2_form].length).toBeLessThanOrEqual(72);
    const payload = Debrief.buildPendingListPayload([], S, [], [{ id: 'sess-9', resume: 'observe2_form', created_at: hoursAgo(1), analysis_data: {} }]);
    expect(payload.action.sections[0].rows[0].description).toBe(S.resume_desc_observe2_form);
  });

  test('the visit Flow\'s "Complete the form" screen says it too', async () => {
    await send();
    newSessions()[0].status = 'observe2_ready';
    const screen = await VisitHandler.handle('coach-1', 'data_exchange', 'MENU', { step: 'work_form' }, 'coach-1', COACH);
    const item = screen.data.items[0];
    expect(item['main-content'].metadata).toMatch(/recorded lesson - fill the form/);
    expect([...item['main-content'].metadata].length).toBeLessThanOrEqual(80);
  });

  test('tapping it sends the form, even while the recording is still being transcribed', async () => {
    seed({
      sessions: [{ id: 'seed-tx', observer_user_id: 'coach-1', user_id: 'coach-1', observation_type: 'leader_observation', status: 'transcribing', debrief_status: 'pending', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
      forms: [{ id: 'form-tx', observer_user_id: 'coach-1', teacher_user_id: null, coaching_session_id: 'seed-tx', visit_context: { recorded_first: true }, answers: {}, photos: [], evidence_review: {}, period_minutes: 34, created_at: new Date().toISOString() }],
    });
    await Resume.resume('seed-tx', FROM, COACH);
    expect(WhatsAppService.sendFlow).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendFlow.mock.calls[0][1]).toMatchObject({ flowToken: 'coach-1:observe2-form:form-tx', body: S2.form_body_after });
  });
});

describe('the form, opened after the lesson', () => {
  const token = (formId) => `coach-1:observe2-form:${formId}`;
  // A form whose recording is already in: held at capture, or sent before Part 1 was saved.
  const seedRecorded = (over = {}) => seed({
    sessions: [{ id: 'seed-rec', observer_user_id: 'coach-1', user_id: 'teacher-a', observation_type: 'leader_observation', status: 'observe2_ready', debrief_status: 'pending', created_at: hoursAgo(1), updated_at: hoursAgo(1) }],
    forms: [{ id: 'form-rec', observer_user_id: 'coach-1', teacher_user_id: 'teacher-a', coaching_session_id: 'seed-rec', visit_context: { recorded_first: true }, answers: {}, photos: [], evidence_review: {}, period_minutes: 34, created_at: hoursAgo(1), ...over }],
  });

  test('Part 1 has no clock: it names the first part of the lesson by its steps', async () => {
    seedRecorded();
    const r = await Endpoint.handleObserve2FormInit(token('form-rec'));
    expect(r.screen).toBe('PART_ONE');
    expect(r.data.part_hint).not.toMatch(/minute|\d\d/i);
    expect(r.data.part_hint).toMatch(/guided practice/);
    expect(r.data.teacher_line).not.toMatch(/-minute period/);
  });

  test('Part 2 and the CONTINUE screen have no clock either', async () => {
    seedRecorded();
    const form = { id: 'form-rec' };
    const p1 = {
      screen: 'PART_ONE', present: '30', p1_spoke: '6', p1_picked: 'once', p1_groups: 'alone', p1_listen: ['turns'],
      p1_listen_other: '', p1_materials: 'teacher', p1_change: 'yes', p1_change_how: 'slow', p1_notes: '',
    };
    const r2 = await Endpoint.handleObserve2FormDataExchange(token(form.id), 'PART_ONE', p1);
    expect(r2.screen).toBe('PART_TWO');
    expect(r2.data.part_hint).not.toMatch(/minute|\d\d/i);
    expect(r2.data.part_hint).toMatch(/independent practice/);
    const c = await Endpoint.handleObserve2FormInit(token(form.id));
    expect(c.screen).toBe('CONTINUE');
    expect(c.data.continue_line).not.toMatch(/minute|\d\d/i);
  });

  // Since form version 5 (pilot sheet R4/R10) a form filled during the lesson is split by the lesson's
  // steps too; it keeps its live hint: save Part 1 when independent practice starts.
  test('a form filled during the lesson, with no recording yet, keeps its live hint', async () => {
    const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-a', visitContext: {} });
    mockDb.__tables.observation_field_forms.find((f) => f.id === form.id).period_minutes = 40;
    const r = await Endpoint.handleObserve2FormInit(token(form.id));
    expect(r.data.part_hint).toMatch(/tap "Part 1 done"/);
    expect(r.data.teacher_line).toMatch(/40-minute period/);
  });
});

describe('copy rules', () => {
  test.each(['en', 'ur'])('the new lines exist in %s, and buttons fit 20 code points', (lang) => {
    const S = observe2Strings(lang);
    expect(typeof S.held_saved(34)).toBe('string');
    expect(typeof S.held_saved(null)).toBe('string');
    expect(typeof S.form_body_after).toBe('string');
    expect([...S.btn_fill_form].length).toBeLessThanOrEqual(20);
    expect([...S.held_saved(34)].length).toBeLessThanOrEqual(1024);
  });

  test('Urdu addresses the coach without gendered verb forms, and isolates the slash command', () => {
    const S = observe2Strings('ur');
    const text = [S.held_saved(34), S.held_saved(null), S.form_body_after, S.btn_fill_form].join(' ');
    expect(text).not.toMatch(/رہی ہیں|رہے ہیں|رہی ہوں|رہے ہوں|سکتی ہیں|سکتے ہیں/);
    if (text.includes('/observe2')) expect(text).toContain('⁦/observe2⁩');
    expect(S.held_saved(34)).toContain('۳۴');
  });
});
