/**
 * L26 (bd-s1oo0.46.2) — the coach conversation, v2 (design/COACH_JOURNEY_V2.md §3.1, CONTRACT §19).
 *
 *   /egra → today's list by classroom [Start] [Send to the teachers]
 *   → "Before the first child" picture [Start with <name>]
 *   → per child: presence [Here, start / Absent / Doesn't want to]
 *       → 1/3 Urdu story, 2/3 English story, 3/3 Maths: plain-text steps, NO buttons, one voice note each
 *       → "✅ <name> done. Thank the child." + the next child's presence prompt
 *   → after the last child: "🎉 All 5 children done (<n> min)" + review.visitSummary + review.sendReview
 *   + the unsent-draft nudge, once, 4 minutes after a step opens with no note.
 *
 * Driven through the real handler (handleText / handleButton / handleVoice). Mocked at the network
 * boundary only: WhatsApp, Redis, R2, Supabase; the other lanes' modules are contract fakes (ports).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createFakeRedis, createWhatsAppRecorder } = require('../L4/helpers/boundary');
const { createFakeSupabase } = require('../../observe2/helpers/fake-supabase');
const { createLaneFakes } = require('../L4/helpers/lane-fakes');

const mockRedis = createFakeRedis();
const mockWa = createWhatsAppRecorder();
mockWa.sendImageBufferWithButtons = jest.fn(async (to, buf, body, buttons) => {
  mockWa.__sent.push({ kind: 'imageButtons', to, bytes: buf.length, body, buttons });
  return true;
});
const mockR2 = { uploadBuffer: jest.fn(async (buf, key) => `https://r2.example/${key}`) };
let mockDb;
jest.mock('../../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../../bot/shared/services/whatsapp.service', () => mockWa);
jest.mock('../../../bot/shared/storage/r2', () => mockR2);
jest.mock('../../../bot/shared/config/supabase', () => ({ from: (t) => mockDb.from(t) }));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../bot/shared/services/menu.service', () => ({ sendMenu: jest.fn(async () => true) }));
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
jest.mock('openai', () => jest.fn().mockImplementation(() => ({ chat: { completions: { create: async () => ({ choices: [{ message: { content: '{}' } }], usage: { cost: 0 } }) } } })));

const { logToFile } = require('../../../bot/shared/utils/logger');
const ports = require('../../../bot/shared/services/child-test/conversation/ports');
const H = require('../../../bot/shared/handlers/child-test.handler');
const nudge = require('../../../bot/shared/services/child-test/conversation/nudge');
const steps = require('../../../bot/shared/services/child-test/conversation/steps');
const { UX_STRINGS } = require('../../../bot/shared/config/ux-strings');

const COACH_ID = '11111111-1111-4111-8111-111111111111';
const SCHOOL_ID = '22222222-2222-4222-8222-222222222222';
const COACH = { id: COACH_ID, role: 'coach', region: 'niete', preferred_language: 'en', phone_number: '923000000001' };
const COACH_UR = { ...COACH, preferred_language: 'ur' };
const PHONE = COACH.phone_number;
const SAVED = { ...process.env };

// The roster as L25 delivers it: full names, class label, class teacher; rolls stay in the data only.
const NAMES = { d1: 'Ayesha Khan', d2: 'Bilal Ahmed', d3: 'Hamza Ali', d4: 'Zainab Noor', d5: 'Fatima Riaz', d6: 'Usman Ghani', d7: 'Sana Iqbal' };
const ROOM = { d1: 'A', d2: 'A', d3: 'B', d4: 'B', d5: 'B', d6: 'A', d7: 'B' };
const TEACHER = { A: { id: 'teacher-1', name: 'Saima Bibi' }, B: { id: 'teacher-2', name: 'Tariq Mehmood' } };
function shapeList(list) {
  const dress = (c) => {
    const room = ROOM[c.drawId];
    return { ...c, displayName: NAMES[c.drawId], section: room, classId: `class-3${room.toLowerCase()}`, classLabel: `3-${room}`,
      grade: 3, teacherName: TEACHER[room].name, teacherUserId: TEACHER[room].id };
  };
  const children = list.children.map(dress);
  return {
    ...list, children, alternates: list.alternates.map(dress),
    classes: ['A', 'B'].map((room) => ({ classId: `class-3${room.toLowerCase()}`, classLabel: `3-${room}`,
      teacherName: TEACHER[room].name, teacherUserId: TEACHER[room].id,
      drawIds: children.filter((c) => ROOM[c.drawId] === room).map((c) => c.drawId) })),
  };
}

let lanes;
let review;
let tmpDir;

function seedDb() {
  mockDb = createFakeSupabase({
    users: [COACH,
      { id: 'teacher-1', name: 'Saima Bibi', phone_number: '923000000011', preferred_language: 'ur' },
      { id: 'teacher-2', name: 'Tariq Mehmood', phone_number: '923000000012', preferred_language: 'en' }],
    leader_schools: [{ leader_user_id: COACH_ID, school_id: SCHOOL_ID, school_name: 'SIM — School', emis: '111' }],
    classes: [{ id: 'class-3a', grade_code: 'grade_3', section: 'A', school_id: SCHOOL_ID, is_active: true },
      { id: 'class-3b', grade_code: 'grade_3', section: 'B', school_id: SCHOOL_ID, is_active: true }],
    class_teachers: [{ teacher_user_id: 'teacher-1', class_id: 'class-3a', is_active: true },
      { teacher_user_id: 'teacher-2', class_id: 'class-3b', is_active: true }],
  });
}

const sent = () => mockWa.__sent;
const last = (kind) => [...sent()].reverse().find((m) => !kind || m.kind === kind);
const textOf = (m) => m.text || m.body || (m.body && m.body.text) || '';
const allText = (msgs = sent()) => msgs.map((m) => [m.text, typeof m.body === 'string' ? m.body : m.body && m.body.text,
  m.header && m.header.text, ...(m.buttons || []).map((b) => b.title)].filter(Boolean).join('\n')).join('\n');
const voice = (id, ts = Math.floor(Date.now() / 1000) + 5) => ({ id: `wamid.${id}`, timestamp: String(ts), audio: { id, mime_type: 'audio/ogg' } });

beforeEach(() => {
  process.env.CHILD_TEST_ENABLED = 'true';
  process.env.DEFAULT_REGION = 'niete-sandbox';
  process.env.RAILWAY_ENVIRONMENT = 'sandbox';
  delete process.env.CHILD_TEST_OBSERVE_LINK;
  delete process.env.CHILD_TEST_BATTERY;
  delete process.env.CHILD_TEST_MATHS_MODE;
  delete process.env.CHILD_TEST_CHECK_MODE;
  delete process.env.CHILD_TEST_STEP_NUDGE_MS;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'l26-'));
  process.env.CHILD_TEST_SETUP_PICTURE_DIR = tmpDir;
  fs.writeFileSync(path.join(tmpDir, 'setup-picture-en.png'), Buffer.from('png-en'));
  fs.writeFileSync(path.join(tmpDir, 'setup-picture-ur.png'), Buffer.from('png-ur'));
  mockRedis.__data.clear();
  mockWa.__sent.length = 0;
  Object.assign(mockWa.__ok, { text: true, buttons: true, list: true, image: true });
  jest.clearAllMocks();
  seedDb();
  lanes = createLaneFakes({ shapeList });
  review = {
    visitSummary: jest.fn(async () => 'Ayesha Khan — Urdu 41 words/min, 2 of 3 answers · English 18, 1 of 3 · Maths 7 of 10'),
    sendReview: jest.fn(async () => ({ ok: true, items: 3 })),
  };
  ports.__setForTest({ ...lanes, review });
});
afterEach(async () => { await H.__drain(); fs.rmSync(tmpDir, { recursive: true, force: true }); });
afterAll(() => { process.env = SAVED; ports.__setForTest(null); });

async function openList(user = COACH) { expect(await H.handleText(PHONE, '/egra', user)).toBe(true); }
async function startVisit(user = COACH) {
  await openList(user);
  expect(await H.handleButton(user, PHONE, 'ctst_start')).toBe(true);
  expect(await H.handleButton(user, PHONE, 'ctst_go')).toBe(true);
}
async function present(drawId, user = COACH) { expect(await H.handleButton(user, PHONE, `ctst_pres:${drawId}:p`)).toBe(true); }
let noteNo = 0;
async function note(user = COACH) {
  noteNo += 1;
  expect(await H.handleVoice(voice(`a${noteNo}`), PHONE, user)).toBe(true);
}
async function testChild(drawId, user = COACH) {
  await present(drawId, user);
  await note(user); await note(user); await note(user);
  await H.__drain();
}
const STEP_BANNED = /roll|رول|Child no\.|بچہ نمبر|\bForm\b|فارم|strip|پٹی/i;

// ---------------------------------------------------------------------------------------- 1. list

describe('1. list and start', () => {
  test('/egra sends the list as one buttons message: Start + Send to the teachers; the list module gets (lang, list)', async () => {
    const list = { buildListMessage: jest.fn(() => ({ header: 'Grade 3 · 5 children', body: 'Today\'s children, by classroom.\n*3-A* · Teacher: Saima Bibi\n1. Ayesha Khan',
      buttons: [{ id: 'ctst_start' }, { id: 'ctst_send_teachers' }] })), buildTeacherMessages: jest.fn(() => []) };
    ports.__setForTest({ ...lanes, review, list });
    await openList();
    expect(list.buildListMessage).toHaveBeenCalledWith('en', expect.objectContaining({ grade: 3, classes: expect.any(Array) }));
    const m = last();
    expect(m.kind).toBe('buttons');
    expect(m.body).toContain('Grade 3 · 5 children');
    expect(m.body).toContain('1. Ayesha Khan');
    expect(m.buttons.map((b) => b.id)).toEqual(['ctst_start', 'ctst_send_teachers']);
    expect(m.buttons.map((b) => b.title)).toEqual(['Start', 'Send to the teachers']);
    for (const b of m.buttons) expect([...b.title].length).toBeLessThanOrEqual(20);
    // no separate "Send to …" offer in v2: the button replaces it
    expect(sent().filter((x) => x.kind === 'buttons')).toHaveLength(1);
  });

  test('without L25\'s list module the stand-in groups by classroom, names in full, alternates last, no roll', async () => {
    await openList();
    const m = last();
    expect(m.kind).toBe('buttons');
    const body = m.body;
    expect(body).toMatch(/Grade 3 · 5 children/);
    expect(body.indexOf('3-A')).toBeLessThan(body.indexOf('Ayesha Khan'));
    expect(body.indexOf('Bilal Ahmed')).toBeLessThan(body.indexOf('3-B'));
    expect(body).toContain('Teacher: Tariq Mehmood');
    expect(body.indexOf('Fatima Riaz')).toBeLessThan(body.indexOf('Usman Ghani'));
    expect(body).not.toMatch(STEP_BANNED);
    expect([...body].length).toBeLessThanOrEqual(1024);
  });

  test('Send to the teachers: each class teacher gets only their own room, in their language; the coach is told who', async () => {
    await openList();
    expect(await H.handleButton(COACH, PHONE, 'ctst_send_teachers')).toBe(true);
    const toSaima = sent().find((m) => m.to === '923000000011');
    const toTariq = sent().find((m) => m.to === '923000000012');
    expect(toSaima.text).toContain('Ayesha Khan');
    expect(toSaima.text).not.toContain('Hamza Ali');
    expect(toSaima.text).toMatch(/[؀-ۿ]/);            // Saima is set to Urdu
    expect(toTariq.text).toContain('Hamza Ali');
    expect(toTariq.text).not.toContain('Ayesha Khan');
    expect(last().to).toBe(PHONE);
    expect(last().text).toMatch(/Sent to Saima Bibi, Tariq Mehmood/);
  });

  test('Send to the teachers uses L25\'s buildTeacherMessages when it has landed', async () => {
    const list = { buildListMessage: () => ({ header: 'H', body: 'B', buttons: [{ id: 'ctst_start' }, { id: 'ctst_send_teachers' }] }),
      buildTeacherMessages: jest.fn((lang) => [{ teacherUserId: 'teacher-1', body: `msg-${lang}-1` }, { teacherUserId: 'teacher-2', body: `msg-${lang}-2` }]) };
    ports.__setForTest({ ...lanes, review, list });
    await openList();
    await H.handleButton(COACH, PHONE, 'ctst_send_teachers');
    expect(sent().find((m) => m.to === '923000000011').text).toBe('msg-ur-1');
    expect(sent().find((m) => m.to === '923000000012').text).toBe('msg-en-2');
  });

  test('the old list body is gone: no "picked by the server", no list rows, no Done: 0 of 5', async () => {
    await openList();
    expect(allText()).not.toMatch(/picked by the server|Done: 0 of 5/);
    expect(sent().some((m) => m.kind === 'list')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------- 2. before the first child

describe('2. before the first child', () => {
  test('Start: the setup picture with its caption and "Start with <name>", once per visit', async () => {
    await openList();
    await H.handleButton(COACH, PHONE, 'ctst_start');
    const m = last();
    expect(m.kind).toBe('imageButtons');
    expect(m.bytes).toBe(Buffer.from('png-en').length);
    expect(m.body).toMatch(/Green Grade 3/);
    expect(m.body).toMatch(/never count anything/);
    expect(m.buttons).toEqual([{ id: 'ctst_go', title: 'Start with Ayesha' }]);
    // a second Start does not show the picture again: straight to the first child
    await H.handleButton(COACH, PHONE, 'ctst_start');
    expect(sent().filter((x) => x.kind === 'imageButtons')).toHaveLength(1);
    expect(last().body).toMatch(/Child 1 of 5 · Ayesha Khan/);
  });

  test('no picture committed yet: the caption goes as text with the same button, logged at warn', async () => {
    fs.rmSync(path.join(tmpDir, 'setup-picture-ur.png'));
    await openList(COACH_UR);
    await H.handleButton(COACH_UR, PHONE, 'ctst_start');
    const m = last();
    expect(m.kind).toBe('buttons');
    expect(m.body).toMatch(/سبز/);
    expect(m.buttons[0].id).toBe('ctst_go');
    expect(logToFile).toHaveBeenCalledWith('child_test.setup_picture_missing', expect.objectContaining({ lang: 'ur' }), 'warn');
  });
});

// ---------------------------------------------------------------------------------------- 3. presence

describe('3. presence', () => {
  test('"Child n of 5 · <child line>" + the greeting to say + Here, start / Absent / Doesn\'t want to', async () => {
    await startVisit();
    const m = last();
    expect(m.kind).toBe('buttons');
    expect(m.body).toMatch(/^\*Child 1 of 5 · Ayesha Khan · 3-A · Teacher: Saima Bibi\*/);
    expect(m.body).toContain('«السلام علیکم');
    expect(m.buttons.map((b) => b.id)).toEqual(['ctst_pres:d1:p', 'ctst_pres:d1:a', 'ctst_pres:d1:r']);
    expect(m.buttons.map((b) => b.title)).toEqual(['Here, start', 'Absent', 'Doesn\'t want to']);
  });

  test('uses L25\'s identity.childLine when it is there', async () => {
    const identity = require('../../../bot/shared/services/child-test/conversation/identity');
    const had = identity.childLine;
    identity.childLine = (lang, c) => `LINE(${lang}:${c.drawId})`;
    try {
      await startVisit();
      expect(last().body).toMatch(/^\*Child 1 of 5 · LINE\(en:d1\)\*/);
    } finally {
      if (had) identity.childLine = had; else delete identity.childLine;
    }
  });

  test('Absent: the alternate joins, and the next child\'s presence prompt follows (no list)', async () => {
    await startVisit();
    await H.handleButton(COACH, PHONE, 'ctst_pres:d1:a');
    const msgs = sent().slice(-2);
    expect(msgs[0].text).toMatch(/Ayesha Khan: absent/);
    expect(msgs[0].text).toMatch(/Usman Ghani joins today's children/);
    expect(msgs[1].kind).toBe('buttons');
    expect(msgs[1].body).toMatch(/^\*Child 1 of 5 · Bilal Ahmed/);
    expect(sent().some((m) => m.kind === 'list')).toBe(false);
  });

  test('Doesn\'t want to: recorded as refused', async () => {
    await startVisit();
    await H.handleButton(COACH, PHONE, 'ctst_pres:d1:r');
    expect(lanes.calls.find((c) => c[0] === 'markOutcome')[1]).toMatchObject({ drawId: 'd1', outcome: 'refused' });
    expect(sent().slice(-2)[0].text).toMatch(/Ayesha Khan: doesn't want to/);
  });
});

// ---------------------------------------------------------------------------------------- 4. three step messages

describe('4. the three step messages', () => {
  test('step 1/3: plain text, no buttons, numbered, the card by colour + grade + side, words to say in «quotes», the 3 questions', async () => {
    await startVisit();
    await present('d1');
    const m = last();
    expect(m.kind).toBe('text');
    const s = m.text;
    expect(s).toMatch(/^\*1\/3 Urdu story · Ayesha Khan\*/);
    expect(s).toMatch(/🟩 Green Grade 3 card, \*Urdu\* side up/);
    for (const n of [1, 2, 3, 4, 5]) expect(s).toMatch(new RegExp(`^${n}\\. `, 'm'));
    expect(s).toContain('«یہ کہانی اونچی آواز میں پڑھیں۔ اب شروع کریں»');
    expect(s).toContain('«آگے پڑھیں»');
    expect(s).toContain('«بس، شکریہ»');
    expect(s).toContain('1:05');
    expect(s).toContain('بلال کس کے ساتھ دریائے جہلم گیا؟');
    expect(s).toContain('بلال خوش کیوں تھا؟');
    expect(s).toMatch(/Can't read any word of the first line\?/);
    expect(s).not.toMatch(STEP_BANNED);
    expect(s).not.toMatch(/first sound|made-up/i);
    expect([...s].length).toBeLessThanOrEqual(1024);
  });

  test('an English-set coach gets English steps; the words to the child stay Urdu (Urdu, maths) and English (English story)', async () => {
    await startVisit();
    await present('d1');
    expect(last().text).toMatch(/Tap 🎤 and slide up to lock/);
    await note();
    const eng = last().text;
    expect(eng).toMatch(/^🎧 Got it · Urdu\n\*2\/3 English story · Ayesha Khan\*/);
    expect(eng).toContain('«Please read this story aloud. Please start reading.»');
    expect(eng).toContain('What was the class planting?');
    await note();
    const maths = last().text;
    expect(maths).toMatch(/\*3\/3 Maths · Ayesha Khan\*/);
    expect(maths).toContain('«اب سوال شروع کریں»');
    expect(maths).toMatch(/A–D/);
    expect(maths).toMatch(/آپ کے پاس ۳ بسکٹ ہیں/);   // word problem 1 (G3), read aloud by the coach
    expect(maths).toMatch(/۱۵ سیب/);
    expect(maths).not.toMatch(STEP_BANNED);
    expect(maths).not.toMatch(/photo|quick sums|60 s/i);
  });

  test('an Urdu-set coach gets Urdu steps (Urdu digits, حساب for maths)', async () => {
    await startVisit(COACH_UR);
    await present('d1', COACH_UR);
    const s = last().text;
    expect(s).toMatch(/مائیک/);
    expect(s).toMatch(/^۱۔ /m);
    expect(s).not.toMatch(/Tap|slide/);
    await note(COACH_UR); await note(COACH_UR);
    expect(last().text).toMatch(/حساب/);
    expect(last().text).not.toMatch(/ریاضی/);
  });

  test('the step message carries no buttons, and nothing is sent after it until a note arrives', async () => {
    await startVisit();
    const before = sent().length;
    await present('d1');
    const after = sent().slice(before);
    expect(after).toHaveLength(1);
    expect(after[0].kind).toBe('text');
    expect(mockWa.sendInteractiveButtons.mock.calls.filter((c) => /1\/3 Urdu/.test(c[1].body))).toHaveLength(0);
  });

  test('a Grade 5 child gets the blue card and the G5 word problems', async () => {
    lanes = createLaneFakes({ shapeList: (l) => { const s = shapeList(l); s.grade = 5; return s; } });
    const orig = lanes.store.createSession;
    lanes.store.createSession = async (a) => { const r = await orig(a); r.session.grade = 5; lanes.sessions[r.session.id].grade = 5; return r; };
    ports.__setForTest({ ...lanes, review });
    await startVisit();
    await present('d1');
    expect(last().text).toMatch(/🟦 Blue Grade 5 card/);
    await note(); await note();
    expect(last().text).toMatch(/۲۵ گیندیں/);
  });
});

// ---------------------------------------------------------------------------------------- 5. one child at a time

describe('5. one child at a time; maths scored once', () => {
  test('child 1 never hears about another child, and nothing says roll, child no., form or strip', async () => {
    await startVisit();
    const from = sent().length - 1;   // the presence prompt
    await present('d1'); await note(); await note();
    const child1 = allText(sent().slice(from));
    for (const other of ['Bilal Ahmed', 'Hamza Ali', 'Zainab Noor', 'Fatima Riaz', 'Usman Ghani', 'Sana Iqbal']) expect(child1).not.toContain(other);
    expect(child1).not.toMatch(STEP_BANNED);
  });

  test('maths: no photo ask, scoreBlock(maths) called exactly once, straight after the maths note', async () => {
    await startVisit();
    await testChild('d1');
    const maths = lanes.calls.filter((c) => c[0] === 'scoreBlock' && c[1].block === 'maths');
    expect(maths).toHaveLength(1);
    expect(allText()).not.toMatch(/strip|photo/i);
    expect(lanes.calls.find((c) => c[0] === 'setSessionStatus' && c[2] === 'completed')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------- 6. auto-advance + end of visit

describe('6. auto-advance and the end of the visit', () => {
  test('after the third note: "✅ <name> done. Thank the child." + the next child\'s presence prompt, in one message', async () => {
    await startVisit();
    await testChild('d1');
    const m = last();
    expect(m.kind).toBe('buttons');
    expect(m.body).toMatch(/^✅ Ayesha Khan done\. Thank the child\.\n\n\*Child 2 of 5 · Bilal Ahmed/);
    expect(m.buttons.map((b) => b.id)).toEqual(['ctst_pres:d2:p', 'ctst_pres:d2:a', 'ctst_pres:d2:r']);
  });

  test('five children: the visit ends with the minutes, the summary and the review; no per-child check (end_review)', async () => {
    await startVisit();
    for (const d of ['d1', 'd2', 'd3', 'd4', 'd5']) await testChild(d);
    await H.__drain();
    const txt = allText();
    expect(txt).toMatch(/🎉 All 5 children done \(\d+ min\)\. Thank the teachers\./);
    expect(review.visitSummary).toHaveBeenCalledWith('en', expect.stringMatching(/^day:/));
    expect(txt).toContain('Ayesha Khan — Urdu 41 words/min');
    expect(review.sendReview).toHaveBeenCalledWith(COACH_ID, expect.stringMatching(/^day:/));
    expect(lanes.calls.filter((c) => c[0] === 'sendCheck')).toHaveLength(0);
    // no "Child 6 of 5"
    expect(txt).not.toMatch(/Child 6/);
  });

  test('CHILD_TEST_CHECK_MODE=per_child: the per-child check is still sent, and no review at the end', async () => {
    process.env.CHILD_TEST_CHECK_MODE = 'per_child';
    await startVisit();
    for (const d of ['d1', 'd2', 'd3', 'd4', 'd5']) await testChild(d);
    await H.__drain();
    expect(lanes.calls.filter((c) => c[0] === 'sendCheck')).toHaveLength(5);
    expect(review.sendReview).not.toHaveBeenCalled();
  });

  test('a whole v2 visit, in English and in Urdu, never says roll / رول / Child no. / بچہ نمبر / Form / فارم', async () => {
    for (const user of [COACH, COACH_UR]) {
      mockRedis.__data.clear(); mockWa.__sent.length = 0;
      lanes = createLaneFakes({ shapeList }); ports.__setForTest({ ...lanes, review });
      await startVisit(user);
      await H.handleButton(user, PHONE, 'ctst_send_teachers');
      await H.handleButton(user, PHONE, 'ctst_pres:d1:a');
      for (const d of ['d2', 'd3', 'd4', 'd5', 'd6']) await testChild(d, user);
      await H.__drain();
      expect(allText()).not.toMatch(/roll|رول|Child no\.|بچہ نمبر|\bForm\b|فارم/i);
      expect(allText()).toMatch(/🎉/);
    }
  });
});

// ---------------------------------------------------------------------------------------- 7. the nudge

describe('7. the unsent-draft nudge', () => {
  const at = (ms) => new Date(Date.now() + ms);
  test('fires once, 4 minutes after a step opens with no note; never before; never after the note', async () => {
    await startVisit();
    await present('d1');
    const n0 = sent().length;
    expect((await nudge.sweepOnce({ now: at(200 * 1000) })).sent).toBe(0);
    expect((await nudge.sweepOnce({ now: at(241 * 1000) })).sent).toBe(1);
    const m = last();
    expect(m.kind).toBe('text');
    expect(m.text).toMatch(/1\/3 Urdu story · Ayesha Khan/);
    expect(m.text).toMatch(/Did the recording stop\? Look for an unsent voice note above the keyboard and press send\. If it's gone, record this part again\./);
    expect((await nudge.sweepOnce({ now: at(400 * 1000) })).sent).toBe(0);
    expect(sent().length).toBe(n0 + 1);
    // the note for step 1 is in: step 1 is never nudged again; step 2 has its own clock
    await note();
    expect((await nudge.sweepOnce({ now: at(200 * 1000) })).sent).toBe(0);
    expect((await nudge.sweepOnce({ now: at(245 * 1000) })).sent).toBe(1);
    expect(last().text).toMatch(/^\*2\/3 English story · Ayesha Khan\*/);
    await note(); await note();
    await H.__drain();
    expect((await nudge.sweepOnce({ now: at(20 * 60 * 1000) })).sent).toBe(0);   // child 2 waits at presence: no step open
  });

  test('CHILD_TEST_STEP_NUDGE_MS sets the delay; the existing 30 s recovery tick runs the nudge sweep', async () => {
    process.env.CHILD_TEST_STEP_NUDGE_MS = '1000';
    await startVisit();
    await present('d1');
    const R = require('../../../bot/shared/services/child-test/conversation/recovery');
    await new Promise((r) => setTimeout(r, 1100));
    await R.__internals.tick();
    expect(last().text).toMatch(/Did the recording stop/);
  });
});

// ---------------------------------------------------------------------------------------- 8. no Menu button; stop

describe('8. no Menu on a step; stopping a child', () => {
  test('no message during a child offers Menu', async () => {
    await startVisit();
    await testChild('d1');
    const ids = sent().flatMap((m) => (m.buttons || []).map((b) => b.id));
    expect(ids).not.toContain('ctst_menu');
  });

  test('/egra mid-child: a resume prompt with Continue and Stop this child; Continue re-sends the open step', async () => {
    await startVisit();
    await present('d1');
    await note();
    await openList();
    const m = last();
    expect(m.kind).toBe('buttons');
    expect(m.body).toMatch(/Ayesha Khan is on part 2\/3 \(English\)/);
    expect(m.buttons.map((b) => b.id)).toEqual(['ctst_resume', 'ctst_stop']);
    await H.handleButton(COACH, PHONE, 'ctst_resume');
    expect(last().kind).toBe('text');
    expect(last().text).toMatch(/\*2\/3 English story · Ayesha Khan\*/);
  });

  test('/cancel during a step stops the child', async () => {
    await startVisit();
    await present('d1');
    expect(await H.handleText(PHONE, '/cancel', COACH)).toBe(true);
    expect(last().text).toMatch(/Stopped the test for Ayesha Khan/);
  });
});

// ---------------------------------------------------------------------------------------- 9. copy

describe('9. copy', () => {
  const L26 = Object.keys(UX_STRINGS).filter((k) => k.startsWith('childTestL26'));
  const BUTTONS = ['childTestL26StartButton', 'childTestL26SendTeachersButton', 'childTestL26StartWith', 'childTestL26Here',
    'childTestL26Absent', 'childTestL26NotWilling', 'childTestL26Continue'];
  test('the L26 block exists, in en and ur', () => {
    expect(L26.length).toBeGreaterThan(20);
    for (const k of L26) {
      expect(typeof UX_STRINGS[k].en).toBe('string');
      expect(UX_STRINGS[k].ur).toMatch(/[؀-ۿ]/);
    }
  });
  test.each(BUTTONS)('%s fits a 20-code-point button with a long first name', (k) => {
    for (const lang of ['en', 'ur']) {
      const s = UX_STRINGS[k][lang].replace('{name}', '');
      expect([...s].length).toBeLessThanOrEqual(k === 'childTestL26StartWith' ? 12 : 20);
    }
  });
  test('Urdu L26 copy: Urdu digits only outside isolated atoms; no gendered verbs about the coach or the child', () => {
    for (const k of L26) {
      const ur = UX_STRINGS[k].ur.replace(/\{\w+\}/g, '').replace(/⁦[^⁩]*⁩/g, '');
      expect([k, /[0-9٠-٩]/.test(ur)]).toEqual([k, false]);
      expect([k, /(رہی|رہا|رہے) (ہیں|ہو|ہے)|سکتی|سکتا ہے|چاہتا|چاہتی|گیا ہے|گئی ہے/.test(UX_STRINGS[k].ur)]).toEqual([k, false]);
    }
  });
  test('one Urdu word per thing: maths is حساب (never ریاضی) in every coach-facing child-test string', () => {
    for (const k of Object.keys(UX_STRINGS).filter((x) => x.startsWith('childTest'))) {
      expect([k, /ریاضی/.test(UX_STRINGS[k].ur)]).toEqual([k, false]);
    }
  });
  test('every rendered step, both languages, both grades, fits a 1024 body', () => {
    for (const lang of ['en', 'ur']) {
      for (const grade of [3, 5]) {
        for (const block of ['urdu', 'english', 'maths']) {
          const s = steps.stepMessage(lang, block, { name: 'Muhammad Abdullah Khan Niazi', grade, form: 'A' });
          expect([...s].length).toBeLessThanOrEqual(1024);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------------------- v1 stays reachable

describe('v1 switch', () => {
  test('CHILD_TEST_MATHS_MODE=strip keeps today\'s list and prompts', async () => {
    process.env.CHILD_TEST_MATHS_MODE = 'strip';
    await openList();
    expect(sent().some((m) => m.kind === 'list')).toBe(true);
  });
  test('CHILD_TEST_BATTERY=v1 keeps today\'s list', async () => {
    process.env.CHILD_TEST_BATTERY = 'v1';
    await openList();
    expect(sent().some((m) => m.kind === 'list')).toBe(true);
  });
});
