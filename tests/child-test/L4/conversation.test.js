/**
 * The coach's child-test conversation on WhatsApp (bd-s1oo0.4), end to end through the L4 handler:
 * /egra → today's list → Present/Absent/Refused → three blocks, one voice note each → maths strip
 * photo → the check. Mocked at the network boundary only (WhatsApp, Redis, R2, Supabase); the other
 * lanes' modules are contract fakes injected through ports (helpers/lane-fakes.js).
 */
const { createFakeRedis, createWhatsAppRecorder } = require('./helpers/boundary');
const { createFakeSupabase } = require('../../observe2/helpers/fake-supabase');
const { createLaneFakes } = require('./helpers/lane-fakes');

const mockRedis = createFakeRedis();
const mockWa = createWhatsAppRecorder();
const mockR2 = { uploadBuffer: jest.fn(async (buf, key) => `https://r2.example/${key}`) };
let mockDb;
jest.mock('../../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../../bot/shared/services/whatsapp.service', () => mockWa);
jest.mock('../../../bot/shared/storage/r2', () => mockR2);
jest.mock('../../../bot/shared/config/supabase', () => ({ from: (t) => mockDb.from(t) }));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../bot/shared/services/menu.service', () => ({ sendMenu: jest.fn(async () => true) }));

const { logError } = require('../../../bot/shared/utils/logger');
const MenuService = require('../../../bot/shared/services/menu.service');
const ports = require('../../../bot/shared/services/child-test/conversation/ports');
const H = require('../../../bot/shared/handlers/child-test.handler');

const COACH = { id: 'coach-1', role: 'coach', region: 'niete', preferred_language: 'en', phone_number: '923000000001' };
const PHONE = COACH.phone_number;
let lanes;
const SAVED = { ...process.env };

function seedDb() {
  mockDb = createFakeSupabase({
    users: [COACH],
    observation_field_forms: [{ id: 'form-1', observer_user_id: 'coach-1', teacher_user_id: 'teacher-1',
      visit_context: { school_ext_id: 'niete:111' }, created_at: new Date().toISOString() }],
    class_teachers: [{ teacher_user_id: 'teacher-1', class_id: 'class-3a', is_active: true }],
    classes: [{ id: 'class-3a', grade_code: 'grade_3', section: 'A', school_id: 'school-1', is_active: true }],
    leader_schools: [{ leader_user_id: 'coach-1', school_id: 'school-1', school_name: 'SIM — School', emis: '111' }],
  });
}

const sent = () => mockWa.__sent;
const last = (kind) => [...sent()].reverse().find((m) => !kind || m.kind === kind);
const voice = (id, ts = Math.floor(Date.now() / 1000) + 5) => ({ id: `wamid.${id}`, timestamp: String(ts), audio: { id, mime_type: 'audio/ogg' } });
const image = (id) => ({ id: `wamid.${id}`, image: { id, mime_type: 'image/jpeg' } });

beforeEach(() => {
  process.env.CHILD_TEST_ENABLED = 'true';
  process.env.DEFAULT_REGION = 'niete-sandbox';
  process.env.RAILWAY_ENVIRONMENT = 'sandbox';
  mockRedis.__data.clear();
  mockWa.__sent.length = 0;
  Object.assign(mockWa.__ok, { text: true, buttons: true, list: true, image: true });
  jest.clearAllMocks();
  seedDb();
  lanes = createLaneFakes();
  ports.__setForTest(lanes);
});
afterEach(() => H.__drain());
afterAll(() => { process.env = SAVED; ports.__setForTest(null); });

async function openList() {
  expect(await H.handleText(PHONE, '/egra', COACH)).toBe(true);
}
async function startChild(drawId = 'd1') {
  expect(await H.handleList(COACH, PHONE, `ctst_child:${drawId}`)).toBe(true);
  expect(await H.handleButton(COACH, PHONE, `ctst_pres:${drawId}:p`)).toBe(true);
}

describe('gate', () => {
  test('flag off: /egra, child-test buttons, voice and images are all left alone', async () => {
    delete process.env.CHILD_TEST_ENABLED;
    expect(await H.handleText(PHONE, '/egra', COACH)).toBe(false);
    expect(await H.handleButton(COACH, PHONE, 'ctst_offer:f:form-1')).toBe(false);
    expect(await H.handleList(COACH, PHONE, 'ctst_child:d1')).toBe(false);
    expect(await H.handleVoice(voice('a1'), PHONE, COACH)).toBe(false);
    expect(await H.handleImage(image('i1'), PHONE, COACH)).toBe(false);
    expect(sent()).toHaveLength(0);
  });
  test('a teacher gets a plain refusal', async () => {
    expect(await H.handleText(PHONE, '/egra', { ...COACH, role: 'teacher' })).toBe(true);
    expect(last('text').text).toMatch(/coaches and school leaders/);
    expect(lanes.calls.find((c) => c[0] === 'todaysList')).toBeUndefined();
  });
});

describe('today\'s list', () => {
  test('/egra during a visit day opens one list: 5 children then 2 alternates, school and grade inferred', async () => {
    await openList();
    const tl = lanes.calls.find((c) => c[0] === 'todaysList')[1];
    expect(tl).toMatchObject({ coachUserId: 'coach-1', schoolId: 'school-1', visitId: 'form-1', observedGrade: 3 });
    const list = last('list');
    expect(list.header.text).toBe('Grade 3 · Class A');
    expect(list.body.text).toMatch(/Done: 0 of 5/);
    const [main, alts] = list.action.sections;
    expect(main.rows.map((r) => r.id)).toEqual(['ctst_child:d1', 'ctst_child:d2', 'ctst_child:d3', 'ctst_child:d4', 'ctst_child:d5']);
    expect(main.rows[4].description).toMatch(/Returning/);
    expect(alts.rows.map((r) => r.id)).toEqual(['ctst_alt:d6', 'ctst_alt:d7']);
    for (const r of [...main.rows, ...alts.rows]) {
      expect([...r.title].length).toBeLessThanOrEqual(24);
      expect([...(r.description || '')].length).toBeLessThanOrEqual(72);
    }
  });
  test('idempotent: a second /egra shows the same children (no redraw)', async () => {
    await openList();
    const first = last('list').action.sections[0].rows.map((r) => r.id);
    await openList();
    expect(last('list').action.sections[0].rows.map((r) => r.id)).toEqual(first);
    const visits = lanes.calls.filter((c) => c[0] === 'todaysList').map((c) => c[1].visitId);
    expect(visits).toEqual(['form-1', 'form-1']);
  });
  test('no class list: the coach is told plainly', async () => {
    lanes = createLaneFakes({ noClassList: true }); ports.__setForTest(lanes);
    await openList();
    expect(last('text').text).toMatch(/no Grade 3 or Grade 5 class list/);
  });
  // With uuid ids the list is drawn on a day key instead (tests/child-test/L3b/machine-visit-key.test.js);
  // these fixture ids are not uuids, so no key can be made and the draw still says missing_visit.
  test('no visit today and one school: the school is taken without asking; with no visit key the coach is told', async () => {
    mockDb.__tables.observation_field_forms.length = 0;
    await openList();
    const tl = lanes.calls.find((c) => c[0] === 'todaysList')[1];
    expect(tl).toMatchObject({ schoolId: 'school-1', observedGrade: null });
    expect(tl.visitId == null && tl.visitKey == null).toBe(true);
    expect(last('text').text).toMatch(/after an \/observe2 visit/);
  });
  test('no visit today and several schools: one list of the coach\'s schools', async () => {
    mockDb.__tables.observation_field_forms.length = 0;
    mockDb.__tables.leader_schools.push({ leader_user_id: 'coach-1', school_id: 'school-2', school_name: 'Another School', emis: '222' });
    await openList();
    const l = last('list');
    expect(l.action.sections[0].rows.map((r) => r.id)).toEqual(['ctst_school:school-2', 'ctst_school:school-1']);
    expect(lanes.calls.find((c) => c[0] === 'todaysList')).toBeUndefined();
  });
  test('a later observe2 visit the same day wins over the list opened earlier (when no child is mid-test)', async () => {
    await openList();
    mockDb.__tables.observation_field_forms.push({ id: 'form-2', observer_user_id: 'coach-1', teacher_user_id: 'teacher-1',
      visit_context: {}, created_at: new Date(Date.now() + 1000).toISOString() });
    await openList();
    expect(lanes.calls.filter((c) => c[0] === 'todaysList').map((c) => c[1].visitId)).toEqual(['form-1', 'form-2']);
  });
  test('mid-test, /egra keeps the list the child belongs to', async () => {
    await openList(); await startChild('d1');
    mockDb.__tables.observation_field_forms.push({ id: 'form-2', observer_user_id: 'coach-1', teacher_user_id: 'teacher-1',
      visit_context: {}, created_at: new Date(Date.now() + 1000).toISOString() });
    await openList();
    expect(lanes.calls.filter((c) => c[0] === 'todaysList').map((c) => c[1].visitId).pop()).toBe('form-1');
  });
  test('tapping an alternate does not start a child', async () => {
    await openList();
    expect(await H.handleList(COACH, PHONE, 'ctst_alt:d6')).toBe(true);
    expect(last('text').text).toMatch(/alternate/i);
    expect(lanes.calls.find((c) => c[0] === 'markOutcome')).toBeUndefined();
  });
});

describe('a child, start to finish', () => {
  test('happy path: three voice notes, the strip photo, then the check — with timings', async () => {
    await openList();
    expect(await H.handleList(COACH, PHONE, 'ctst_child:d1')).toBe(true);
    const pres = last('buttons');
    expect(pres.body).toMatch(/^\*Child 1 of 5\*/);
    expect(pres.buttons.map((b) => b.id)).toEqual(['ctst_pres:d1:p', 'ctst_pres:d1:a', 'ctst_pres:d1:r']);

    expect(await H.handleButton(COACH, PHONE, 'ctst_pres:d1:p')).toBe(true);
    expect(lanes.calls.find((c) => c[0] === 'markOutcome')[1]).toMatchObject({ drawId: 'd1', outcome: 'present', visitId: 'form-1' });
    expect(lanes.calls.find((c) => c[0] === 'createSession')[1]).toMatchObject({ drawId: 'd1', coachUserId: 'coach-1', visitId: 'form-1', channel: 'whatsapp' });
    expect(sent().filter((m) => m.kind === 'image')).toHaveLength(2);
    expect(last('buttons').body).toMatch(/^\*Child 1 of 5 · Urdu 1\/3\*/);
    expect(last('buttons').body).toMatch(/«شروع»/);

    // Urdu voice note: acknowledged at once, stored under CONTRACT §4, scored off the critical path.
    const before = sent().length;
    expect(await H.handleVoice(voice('a-urdu'), PHONE, COACH)).toBe(true);
    expect(sent()[before]).toMatchObject({ kind: 'text', text: '🎧 Got it · Urdu' });
    expect(mockR2.uploadBuffer).toHaveBeenCalledWith(expect.any(Buffer), 'child-test/sandbox/school-1/sess-1/urdu.ogg', 'audio/ogg');
    expect(lanes.calls.find((c) => c[0] === 'attachBlockMedia')[1]).toEqual({ sessionId: 'sess-1', block: 'urdu', audioR2Key: 'child-test/sandbox/school-1/sess-1/urdu.ogg' });
    expect(last('buttons').body).toMatch(/Urdu|English/);
    expect(last('buttons').body).toMatch(/^\*Child 1 of 5 · English 2\/3\*/);

    expect(await H.handleVoice(voice('a-eng'), PHONE, COACH)).toBe(true);
    expect(last('buttons').body).toMatch(/^\*Child 1 of 5 · Maths 3\/3\*/);
    expect(await H.handleVoice(voice('a-maths'), PHONE, COACH)).toBe(true);
    await H.__drain();
    // maths is scored once, after the photo (ai_marks are written once)
    expect(lanes.calls.filter((c) => c[0] === 'scoreBlock').map((c) => c[1].block)).toEqual(['urdu', 'english']);
    expect(lanes.calls.filter((c) => c[0] === 'scoreBlock')[0][1]).toEqual({ sessionId: 'sess-1', block: 'urdu', grade: 3, form: 'A' });
    expect(sent().some((m) => m.kind === 'buttons' && /send a photo of the strip/.test(m.body))).toBe(true);
    expect(last('list')).toBeTruthy();
    expect(lanes.calls.find((c) => c[0] === 'sendCheck')).toBeUndefined();

    // The strip photo may come later; it is claimed for the child it belongs to.
    expect(await H.handleImage(image('img-1'), PHONE, COACH)).toBe(true);
    expect(mockR2.uploadBuffer).toHaveBeenCalledWith(expect.any(Buffer), 'child-test/sandbox/school-1/sess-1/maths-strip.jpg', 'image/jpeg');
    expect(sent().some((m) => m.kind === 'text' && /Strip saved for Roll 1/.test(m.text))).toBe(true);
    await H.__drain();
    expect(lanes.calls.filter((c) => c[0] === 'scoreBlock').map((c) => c[1].block)).toEqual(['urdu', 'english', 'maths']);
    expect(lanes.calls.filter((c) => c[0] === 'sendCheck')).toEqual([['sendCheck', 'sess-1']]);
    expect(lanes.sessions['sess-1'].status).toBe('completed');

    const t = Object.keys(lanes.sessions['sess-1'].timings);
    for (const k of ['list.opened', 'child.tapped', 'child.present', 'urdu.card_sent.1', 'urdu.card_sent.2', 'urdu.prompt_sent',
      'urdu.voice_received', 'urdu.audio_saved', 'urdu.scored', 'english.voice_received', 'maths.voice_received',
      'maths.photo_received', 'maths.scored', 'check.sent']) expect(t).toContain(k);
  });

  test('the next child can start before the strip photo arrives; "Checks waiting" shows on the list', async () => {
    await openList();
    await startChild('d1');
    for (const b of ['u', 'e', 'm']) await H.handleVoice(voice(`c1-${b}`), PHONE, COACH);
    await startChild('d2');
    expect(last('buttons').body).toMatch(/^\*Child 2 of 5 · Urdu 1\/3\*/);
    await H.handleImage(image('strip-1'), PHONE, COACH);   // child 1's strip, sent while child 2 is on Urdu
    await H.__drain();
    expect(lanes.calls.filter((c) => c[0] === 'sendCheck')).toEqual([['sendCheck', 'sess-1']]);
    // child 2's Urdu is still waiting for its voice note, and gets it
    expect(await H.handleVoice(voice('c2-u'), PHONE, COACH)).toBe(true);
    expect(lanes.calls.filter((c) => c[0] === 'attachBlockMedia').pop()[1]).toMatchObject({ sessionId: 'sess-2', block: 'urdu' });
    await H.handleText(PHONE, '/cancel', COACH);
    await openList();
    expect(last('list').body.text).toMatch(/Checks waiting: 1/);
  });

  test('the maths script says the numbers cue first, then the start cue for the 60-second quick sums', async () => {
    await openList();
    await startChild('d1');
    for (const b of ['u', 'e']) await H.handleVoice(voice(`q-${b}`), PHONE, COACH);
    const prompt = sent().filter((m) => m.kind === 'buttons' && /Maths 3\/3/.test(m.body)).pop();
    expect(prompt).toBeTruthy();
    const iNumbers = prompt.body.indexOf('اب یہ نمبر باری باری پڑھیں');
    const iSums = prompt.body.indexOf('اب سوال شروع کریں');
    expect(iNumbers).toBeGreaterThan(-1);
    expect(iSums).toBeGreaterThan(iNumbers);
  });

  test('"No strip photo" completes the child and the check follows', async () => {
    await openList();
    await startChild('d1');
    for (const b of ['u', 'e', 'm']) await H.handleVoice(voice(`n-${b}`), PHONE, COACH);
    expect(await H.handleButton(COACH, PHONE, 'ctst_nophoto:sess-1')).toBe(true);
    await H.__drain();
    expect(lanes.calls.filter((c) => c[0] === 'scoreBlock').map((c) => c[1].block)).toEqual(['urdu', 'english', 'maths']);
    // CONTRACT §12 CR-2: without force, L5 answers 'pending' for a maths block with no photo and never writes marks.
    const scoreCalls = lanes.calls.filter((c) => c[0] === 'scoreBlock').map((c) => c[1]);
    expect(scoreCalls.find((a) => a.block === 'maths')).toMatchObject({ sessionId: 'sess-1', block: 'maths', force: true });
    expect(scoreCalls.filter((a) => a.block !== 'maths').every((a) => a.force === undefined)).toBe(true);
    expect(lanes.calls.filter((c) => c[0] === 'sendCheck')).toHaveLength(1);
    expect(await H.handleImage(image('late'), PHONE, COACH)).toBe(false);   // nothing pending any more
  });

  test('a failed check send is told to the coach and logged at error', async () => {
    lanes.checkFlow.result = false;
    await openList(); await startChild('d1');
    for (const b of ['u', 'e', 'm']) await H.handleVoice(voice(`f-${b}`), PHONE, COACH);
    await H.handleButton(COACH, PHONE, 'ctst_nophoto:sess-1');
    await H.__drain();
    expect(sent().some((m) => m.kind === 'text' && /check for Roll 1 is ready but did not open/.test(m.text))).toBe(true);
    expect(logError).toHaveBeenCalledWith(expect.stringMatching(/child_test\.check_send_failed/), expect.objectContaining({ sessionId: 'sess-1' }));
  });
});

describe('absent and refused', () => {
  test.each([['a', 'absent', /marked absent/], ['r', 'refused', /refused/]])('%s: nothing more is asked, the alternate is promoted', async (code, outcome, rx) => {
    await openList();
    await H.handleList(COACH, PHONE, 'ctst_child:d2');
    expect(await H.handleButton(COACH, PHONE, `ctst_pres:d2:${code}`)).toBe(true);
    expect(lanes.calls.find((c) => c[0] === 'markOutcome')[1]).toMatchObject({ drawId: 'd2', outcome });
    expect(lanes.calls.find((c) => c[0] === 'createSession')).toBeUndefined();
    expect(sent().some((m) => m.kind === 'text' && rx.test(m.text) && /Roll 6 from the alternates/.test(m.text))).toBe(true);
    const rows = last('list').action.sections[0].rows;
    // the five to test first, then the absent/refused child, marked; "of 5" counts only the five
    expect(rows.map((r) => r.id)).toEqual(['ctst_child:d1', 'ctst_child:d3', 'ctst_child:d4', 'ctst_child:d6', 'ctst_child:d5', 'ctst_child:d2']);
    expect(rows[5].description).toMatch(outcome === 'absent' ? /Absent/ : /Refused/);
    expect(last('list').body.text).toMatch(/Done: 0 of 5/);
    expect(await H.handleVoice(voice('stray'), PHONE, COACH)).toBe(false);
    // tapping the absent child again starts nothing
    await H.handleList(COACH, PHONE, 'ctst_child:d2');
    expect(last('text').text).toMatch(rx);
    expect(lanes.calls.filter((c) => c[0] === 'markOutcome')).toHaveLength(1);
    // the promoted child is now "Child 4 of 5"
    await H.handleList(COACH, PHONE, 'ctst_child:d6');
    expect(last('buttons').body).toMatch(/^\*Child 4 of 5\*/);
  });
});

describe('claims only in its own state', () => {
  test('no child-test state: voice and images go to the normal pipeline', async () => {
    expect(await H.handleVoice(voice('x'), PHONE, COACH)).toBe(false);
    expect(await H.handleImage(image('y'), PHONE, COACH)).toBe(false);
  });
  test('list open but no block waiting: a voice note is not claimed', async () => {
    await openList();
    expect(await H.handleVoice(voice('x'), PHONE, COACH)).toBe(false);
    await H.handleList(COACH, PHONE, 'ctst_child:d1');      // presence question, still no block
    expect(await H.handleVoice(voice('x2'), PHONE, COACH)).toBe(false);
    expect(await H.handleImage(image('y'), PHONE, COACH)).toBe(false);
  });
  test('a voice note sent before the next block\'s card is not taken for that block', async () => {
    await openList(); await startChild('d1');
    await H.handleVoice(voice('u1'), PHONE, COACH);
    const early = voice('u1-dup', Math.floor(Date.now() / 1000) - 60);
    expect(await H.handleVoice(early, PHONE, COACH)).toBe(true);
    expect(last('text').text).toMatch(/sent before the English card/);
    expect(lanes.calls.filter((c) => c[0] === 'attachBlockMedia')).toHaveLength(1);
  });
  test('the same voice note delivered twice is stored once', async () => {
    await openList(); await startChild('d1');
    const v = voice('dup');
    await H.handleVoice(v, PHONE, COACH);
    expect(await H.handleVoice(v, PHONE, COACH)).toBe(true);
    expect(lanes.calls.filter((c) => c[0] === 'attachBlockMedia')).toHaveLength(1);
  });
});

describe('failures are visible', () => {
  test('a failed card image falls back to the text version and logs at error', async () => {
    mockWa.__ok.image = false;
    await openList(); await startChild('d1');
    expect(sent().some((m) => m.kind === 'text' && /picture did not send/.test(m.text) && /story line one/.test(m.text))).toBe(true);
    expect(logError).toHaveBeenCalledWith(expect.stringMatching(/child_test\.card_send_failed/), expect.objectContaining({ block: 'urdu' }));
  });
  test('a failed audio save tells the coach and stays on the same block', async () => {
    lanes.fail.attachBlockMedia = true;
    await openList(); await startChild('d1');
    expect(await H.handleVoice(voice('bad'), PHONE, COACH)).toBe(true);
    expect(last('text').text).toMatch(/Urdu voice note did not save/);
    expect(logError).toHaveBeenCalledWith(expect.stringMatching(/child_test\.audio_save_failed/), expect.anything());
    lanes.fail.attachBlockMedia = false;
    expect(await H.handleVoice(voice('bad'), PHONE, COACH)).toBe(true);   // the same note again now saves
    expect(lanes.calls.filter((c) => c[0] === 'attachBlockMedia' && c[1].block === 'urdu')).toHaveLength(2);
    expect(last('buttons').body).toMatch(/English 2\/3/);
  });
  test('an R2 upload throw is the same visible failure', async () => {
    mockR2.uploadBuffer.mockRejectedValueOnce(new Error('R2 down'));
    await openList(); await startChild('d1');
    await H.handleVoice(voice('r2'), PHONE, COACH);
    expect(last('text').text).toMatch(/did not save/);
  });
  test('a failed session create tells the coach', async () => {
    lanes.fail.createSession = true;
    await openList(); await startChild('d1');
    expect(last('text').text).toMatch(/couldn't start this child's test/);
    expect(logError).toHaveBeenCalled();
  });
  test('a failed strip-photo save tells the coach and keeps the photo pending', async () => {
    await openList(); await startChild('d1');
    for (const b of ['u', 'e', 'm']) await H.handleVoice(voice(`p-${b}`), PHONE, COACH);
    lanes.fail.attachBlockMedia = true;
    expect(await H.handleImage(image('p1'), PHONE, COACH)).toBe(true);
    expect(last('text').text).toMatch(/strip photo for Roll 1 did not save/);
    lanes.fail.attachBlockMedia = false;
    expect(await H.handleImage(image('p1'), PHONE, COACH)).toBe(true);
    expect(sent().some((m) => m.kind === 'text' && /Strip saved/.test(m.text))).toBe(true);
  });
});

describe('once claimed, media never falls through', () => {
  test('a crash after the strip photo is saved is logged, and the photo stays the child test\'s', async () => {
    await openList(); await startChild('d1');
    for (const b of ['u', 'e', 'm']) await H.handleVoice(voice(`k-${b}`), PHONE, COACH);
    lanes.store.setSessionStatus = async () => { throw new Error('boom'); };
    expect(await H.handleImage(image('k1'), PHONE, COACH)).toBe(true);
    expect(logError).toHaveBeenCalledWith('child_test.photo_failed', expect.objectContaining({ sessionId: 'sess-1' }));
  });
  test('a crash after a voice note is saved is logged, and the note stays the child test\'s', async () => {
    await openList(); await startChild('d1');
    lanes.store.recordTiming = async () => { throw new Error('boom'); };
    lanes.render.renderInlineCards = async () => { throw new Error('boom'); };
    const orig = mockWa.sendInteractiveButtons.getMockImplementation();
    mockWa.sendInteractiveButtons.mockImplementationOnce(async () => { throw new Error('graph down'); });
    expect(await H.handleVoice(voice('k-v'), PHONE, COACH)).toBe(true);
    expect(logError).toHaveBeenCalledWith('child_test.voice_failed', expect.objectContaining({ sessionId: 'sess-1' }));
    mockWa.sendInteractiveButtons.mockImplementation(orig);
  });
});

describe('/cancel and /menu work in every state', () => {
  const noRelease = () => expect(lanes.calls.filter((c) => c[0] === 'markOutcome' && c[1].outcome !== 'present')).toHaveLength(0);

  test('at the presence question', async () => {
    await openList(); await H.handleList(COACH, PHONE, 'ctst_child:d1');
    expect(await H.handleText(PHONE, '/cancel', COACH)).toBe(true);
    expect(last('text').text).toMatch(/Stopped the test for Roll 1/);
    expect(await H.handleButton(COACH, PHONE, 'ctst_pres:d1:p')).toBe(true);   // a stale tap is not a start
    expect(lanes.calls.find((c) => c[0] === 'createSession')).toBeUndefined();
    noRelease();
  });
  test('waiting for a voice note (typed)', async () => {
    await openList(); await startChild('d1');
    expect(await H.handleText(PHONE, '/cancel', COACH)).toBe(true);
    expect(lanes.sessions['sess-1'].status).toBe('abandoned');
    expect(await H.handleVoice(voice('after'), PHONE, COACH)).toBe(false);
    noRelease();
  });
  test('waiting for a voice note (tapped)', async () => {
    await openList(); await startChild('d1');
    const stop = last('buttons').buttons.find((b) => b.id === 'ctst_stop');
    expect(stop).toBeTruthy();
    expect(await H.handleButton(COACH, PHONE, 'ctst_stop')).toBe(true);
    expect(lanes.sessions['sess-1'].status).toBe('abandoned');
    noRelease();
  });
  test('Urdu typed cancel works too', async () => {
    await openList(); await startChild('d1');
    expect(await H.handleText(PHONE, 'منسوخ', COACH)).toBe(true);
    expect(lanes.sessions['sess-1'].status).toBe('abandoned');
  });
  test('a stopped child resumes where it stopped, with the same draw', async () => {
    await openList(); await startChild('d1');
    await H.handleVoice(voice('res-u'), PHONE, COACH);
    await H.handleText(PHONE, '/cancel', COACH);
    expect(await H.handleList(COACH, PHONE, 'ctst_child:d1')).toBe(true);
    expect(last('buttons').body).toMatch(/English 2\/3/);
    expect(Object.keys(lanes.sessions)).toEqual(['sess-1']);   // createSession is idempotent per draw
    expect(lanes.sessions['sess-1'].status).toBe('in_progress');
  });
  test('at the list: closes; /egra reopens the same list', async () => {
    await openList();
    expect(await H.handleText(PHONE, '/cancel', COACH)).toBe(true);
    expect(last('text').text).toMatch(/Child test closed/);
    expect(await H.handleText(PHONE, '/cancel', COACH)).toBe(false);   // nothing of ours open: not claimed
    await openList();
    expect(last('list').action.sections[0].rows[0].id).toBe('ctst_child:d1');
  });
  test('/menu typed mid-block stops the child and lets the normal /menu run', async () => {
    await openList(); await startChild('d1');
    expect(await H.handleText(PHONE, '/menu', COACH)).toBe(false);
    expect(lanes.sessions['sess-1'].status).toBe('abandoned');
    expect(await H.handleVoice(voice('m'), PHONE, COACH)).toBe(false);
  });
  test('Menu tapped mid-block stops the child and sends the menu', async () => {
    await openList(); await startChild('d1');
    expect(await H.handleButton(COACH, PHONE, 'ctst_menu')).toBe(true);
    expect(MenuService.sendMenu).toHaveBeenCalledWith(PHONE, 'coach-1', null, 'en', COACH);
    expect(lanes.sessions['sess-1'].status).toBe('abandoned');
  });
  test('other text mid-block is not swallowed', async () => {
    await openList(); await startChild('d1');
    expect(await H.handleText(PHONE, 'what is a lesson plan?', COACH)).toBe(false);
  });
});

describe('the offer at the end of observe2', () => {
  test('gated on: two buttons carrying the visit id', async () => {
    expect(await H.sendOffer({ coachUserId: 'coach-1', kind: 'f', id: 'form-1' })).toBe(true);
    const m = last('buttons');
    expect(m.to).toBe(PHONE);
    expect(m.body).toMatch(/Test 5 children now\? About 25 minutes/);
    expect(m.buttons.map((b) => b.id)).toEqual(['ctst_offer:f:form-1', 'ctst_later:f:form-1']);
  });
  test('gated off: nothing is sent', async () => {
    delete process.env.CHILD_TEST_ENABLED;
    expect(await H.sendOffer({ coachUserId: 'coach-1', kind: 'f', id: 'form-1' })).toBe(false);
    expect(sent()).toHaveLength(0);
  });
  test('Yes opens the list for that visit', async () => {
    expect(await H.handleButton(COACH, PHONE, 'ctst_offer:f:form-1')).toBe(true);
    expect(lanes.calls.find((c) => c[0] === 'todaysList')[1]).toMatchObject({ visitId: 'form-1', schoolId: 'school-1', observedGrade: 3 });
    expect(last('list')).toBeTruthy();
  });
  test('a visit that is not the coach\'s own is refused', async () => {
    mockDb.__tables.observation_field_forms[0].observer_user_id = 'someone-else';
    expect(await H.handleButton(COACH, PHONE, 'ctst_offer:f:form-1')).toBe(true);
    expect(lanes.calls.find((c) => c[0] === 'todaysList')).toBeUndefined();
    expect(last('text').text).toMatch(/older list|Send \/egra/);
  });
});

describe('Urdu', () => {
  test('an Urdu coach gets Urdu copy with Urdu digits', async () => {
    const UR = { ...COACH, preferred_language: 'ur' };
    mockDb.__tables.users[0].preferred_language = 'ur';
    await H.handleText(PHONE, 'بچوں کا ٹیسٹ', UR);
    expect(last('list').body.text).toMatch(/مکمل: ۵ میں سے ۰/);
    await H.handleList(UR, PHONE, 'ctst_child:d1');
    await H.handleButton(UR, PHONE, 'ctst_pres:d1:p');
    expect(last('buttons').body).toMatch(/بچہ ۱ از ۵ · اردو ۱\/۳/);
    for (const b of last('buttons').buttons) expect([...b.title].length).toBeLessThanOrEqual(20);
  });
});
