/**
 * /observe2: the coach's own notes are in front of them BEFORE the conversation with the teacher
 * (FICO pilot sheet R23, 16 Oct: "Notes that we take during observation in the optional tab should be
 * visible to us. Before debriefing the teacher as it contains teachers areas of growth and strengths").
 *
 * Since round 6 the notes come back in the brief, but the brief is sent only on "Debrief now", after the
 * check is submitted. On prod since 16 Oct, 30 of 47 debriefs began before the check was submitted (24
 * while it was open, 5 between the seal and the check, 1 before the seal); on 21 Oct a coach's 10-minute
 * debrief recording arrived 30 seconds after the brief that carried the notes.
 *
 * Now the notes also come:
 *   - in the chat with the "Record sealed" message, in the coach's language (the seal always comes first);
 *   - on the check's "Work on first" screen, read-only, as screen data.
 * They are the brief's own notes section (one function), without "Why you changed", which belongs to the
 * check itself.
 *
 * Real: the form and check endpoints, the store, the rules, the brief. Mocked: the database (in memory),
 * WhatsApp, the debrief service's chat side, the photo storage.
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
jest.mock('../../bot/shared/services/observe/observe-debrief.service', () => ({
  displayTimeZone: () => 'Asia/Karachi',
  acknowledgeFormSubmitted: jest.fn(() => Promise.resolve()),
}));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const Form = require('../../bot/shared/routes/observe2-form-endpoint');
const Check = require('../../bot/shared/routes/observe2-check-endpoint');
const { buildEvidenceCheckFlow, CHECK_VERSION } = require('../../bot/shared/services/observe/observe2/evidence-check.flow');
const { observe2Strings } = require('../../bot/shared/services/observe/observe2/strings');

const formToken = (id) => `coach-1:observe2-form:${id}`;
const checkToken = (id) => `coach-1:observe2-check:${id}`;
const row = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);
const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r)); };
const cp = (s) => [...String(s)].length;

// A form opened on today's Flow (form version 5), its notes made up for the test.
const { FORM_VERSION } = require('../../bot/shared/services/observe/observe2/field-form.flow');

const PART_1 = {
  screen: 'PART_ONE', fv: FORM_VERSION, present: '32', p1_spoke: '6', p1_picked: 'once', p1_groups: 'alone', p1_listen: ['turns'],
  p1_listen_other: '', p1_materials: 'children', p1_used: ['book'], p1_change: 'yes', p1_change_how: 'slow',
  p1_notes: '* recall done.\n* asking open ended questions.',
};
const PART_2 = {
  screen: 'PART_TWO', fv: FORM_VERSION, p2_spoke: '10', p2_new: '5', p2_task: 'all', p2_teacher: ['round'], p2_stuck: 'unsure',
  p2_think: ['why'], p2_change: 'no', p2_notes: '! First guided practice, then independent practice.',
};
const PLAN_NONE = { screen: 'LESSON_PLAN', fv: FORM_VERSION, lp: 'none' };
const SEAL = { screen: 'AFTER', incident: 'none', detail: '', note: 'The back rows could not see the board', priority: 'C7', seal_ok: true };

async function newForm(patch = {}) {
  const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: {} });
  Object.assign(row(form.id), { period_minutes: 40 }, patch);
  return form.id;
}

async function fillAndSeal(id, { part1 = PART_1, part2 = PART_2, seal = SEAL } = {}) {
  await Form.handleObserve2FormDataExchange(formToken(id), 'PART_ONE', part1);
  await Form.handleObserve2FormDataExchange(formToken(id), 'PART_TWO', part2);
  await Form.handleObserve2FormDataExchange(formToken(id), 'LESSON_PLAN', PLAN_NONE);
  const out = await Form.handleObserve2FormDataExchange(formToken(id), 'AFTER', seal);
  await flush();
  return out;
}

const sealedTexts = () => WhatsAppService.sendMessage.mock.calls.map((c) => c[1]);

beforeEach(() => {
  jest.clearAllMocks();
  mockFake = createFakeSupabase({
    users: [
      { id: 'coach-1', phone_number: '923000000001', name: 'Coach', preferred_language: 'en', role: 'coach' },
      { id: 'teacher-1', phone_number: '923000000002', name: 'Rabia', preferred_language: 'en', role: 'teacher' },
    ],
  });
});

describe('the "Record sealed" message carries the notes', () => {
  test('one message: the sealed line and the recording steps, then every note under its label, word for word', async () => {
    const id = await newForm();
    const out = await fillAndSeal(id);
    expect(out.screen).toBe('SEALED');
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    const [to, text] = WhatsAppService.sendMessage.mock.calls[0];
    expect(to).toBe('923000000001');
    expect(text).toMatch(/^✅ Record sealed at \d{2}:\d{2}/);
    expect(text).toMatch(/recorder/i);
    const notes = text.slice(text.indexOf('📝 Your notes, as you wrote them:'));
    expect(text.indexOf('📝 Your notes, as you wrote them:')).toBeGreaterThan(text.indexOf('recorder'));
    expect(notes).toContain(`*Part 1*\n${PART_1.p1_notes}`);
    expect(notes).toContain(`*Part 2*\n${PART_2.p2_notes}`);
    expect(notes).toContain(`*Not in the recording*\n${SEAL.note}`);
  });

  test('in Urdu for an Urdu coach: the brief\'s own Urdu title and labels, the notes as typed', async () => {
    mockFake.__tables.users[0].preferred_language = 'ur';
    const id = await newForm();
    await fillAndSeal(id);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    const text = sealedTexts()[0];
    expect(text.startsWith('✅ ریکارڈ')).toBe(true);
    expect(text).toContain('📝 آپ کے نوٹس، جیسے آپ نے لکھے:');
    expect(text).toContain(`*پہلا حصہ*\n${PART_1.p1_notes}`);
    expect(text).toContain(`*دوسرا حصہ*\n${PART_2.p2_notes}`);
  });

  test('the recording came first: the "already in" line, then the notes', async () => {
    process.env.OBSERVE2_CHECK_FLOW_ID = 'F-CHECK';
    try {
      const id = await newForm();
      Object.assign(row(id), { coaching_session_id: 'sess-1', moments_ready_at: '2026-10-21T05:12:54.000Z', rumi_moments: { moments: [] } });
      await fillAndSeal(id);
      const text = sealedTexts()[0];
      expect(text).toMatch(/recording is already in/i);
      expect(text).toContain(`*Part 1*\n${PART_1.p1_notes}`);
    } finally { delete process.env.OBSERVE2_CHECK_FLOW_ID; }
  });

  test('nothing typed: the sealed message exactly as before', async () => {
    const id = await newForm();
    await fillAndSeal(id, { part1: { ...PART_1, p1_notes: '' }, part2: { ...PART_2, p2_notes: '' }, seal: { ...SEAL, note: '' } });
    expect(sealedTexts()).toHaveLength(1);
    expect(sealedTexts()[0]).not.toContain('📝');
    expect(sealedTexts()[0]).toBe(observe2Strings('en').sealed_chat(sealedTexts()[0].match(/\d{2}:\d{2}/)[0]));
  });

  test('every box full still fits one WhatsApp message (4,096 code points); a long note is clipped, never dropped', async () => {
    const long = (c) => c.repeat(600);
    const id = await newForm();
    await fillAndSeal(id, {
      part1: { ...PART_1, p1_notes: long('ا'), p1_groups: 'groups', p1_listen_other: long('b') },
      part2: { ...PART_2, p2_notes: long('c') },
      seal: { ...SEAL, incident: 'ridicule', detail: long('d'), note: long('e') },
    });
    expect(sealedTexts()).toHaveLength(1);
    const text = sealedTexts()[0];
    expect(cp(text)).toBeLessThanOrEqual(4096);
    expect(text).toContain(`${'ا'.repeat(399)}…`);
    expect(text).toContain(`${'e'.repeat(399)}…`);
  });

  // Unreachable with today's clip (every box full is about 3,300 code points with the sealed text), and kept
  // because Meta refuses the WHOLE message past the cap: the recording steps must never be lost to a note.
  test('a sealed message and notes that would not fit go as two messages, the recording steps first', async () => {
    const sealedText = `✅ Record sealed at 10:15.\n${'x'.repeat(3900)}`;
    const form = { answers: { p1_notes: 'n'.repeat(300) } };
    await Form.__sendSealed(WhatsAppService, '923000000001', sealedText, form, 'en');
    expect(sealedTexts()).toEqual([sealedText, `📝 Your notes, as you wrote them:\n*Part 1*\n${'n'.repeat(300)}`]);
  });
});

describe('the check\'s "Work on first" screen shows the notes', () => {
  async function checkable(answers) {
    const id = await newForm({
      answers: { lp: 'none', priority: 'C7', ...answers }, sealed_at: '2026-10-21T06:50:46.000Z', part1_done_at: 'x', part2_done_at: 'x',
      coaching_session_id: 'sess-1', rumi_moments: { moments: [], counts: {} }, moments_ready_at: 'x',
      evidence_review: { why: 'an earlier answer on this screen' },
    });
    return id;
  }

  test('the screen data carries the notes, each under its label, without "Why you changed"', async () => {
    const id = await checkable({ p1_notes: PART_1.p1_notes, p2_notes: PART_2.p2_notes, note: SEAL.note });
    const out = await Check.handleObserve2CheckDataExchange(checkToken(id), 'ADDED_TWO', { screen: 'ADDED_TWO', cv: CHECK_VERSION });
    expect(out.screen).toBe('PRIORITY');
    expect(out.data.priority_level).toBe('C7');
    expect(out.data.notes_v).toBe(true);
    expect(out.data.notes_body).toBe([
      'Part 1', PART_1.p1_notes, '', 'Part 2', PART_2.p2_notes, '', 'Not in the recording', SEAL.note,
    ].join('\n'));
    expect(out.data.notes_body).not.toContain('an earlier answer');
  });

  test('the round-6 check (version 2), still open on coaches\' phones, gets the same notes', async () => {
    const id = await checkable({ p1_notes: PART_1.p1_notes });
    const out = await Check.handleObserve2CheckDataExchange(checkToken(id), 'ADDED_TWO', { screen: 'ADDED_TWO', cv: '2' });
    expect(out.data).toMatchObject({ priority_level: 'C7', notes_v: true, notes_body: `Part 1\n${PART_1.p1_notes}` });
  });

  test('nothing typed: the block is hidden, and its text is an empty string (Meta refuses null)', async () => {
    const id = await checkable({});
    const out = await Check.handleObserve2CheckDataExchange(checkToken(id), 'ADDED_TWO', { screen: 'ADDED_TWO', cv: CHECK_VERSION });
    expect(out.data).toMatchObject({ notes_v: false, notes_body: '' });
  });

  test('a check opened before "Also work on" (no cv) keeps its own screen\'s data, unchanged', async () => {
    const id = await checkable({ p1_notes: PART_1.p1_notes });
    const out = await Check.handleObserve2CheckDataExchange(checkToken(id), 'ADDED_TWO', { screen: 'ADDED_TWO' });
    expect(out).toEqual({ screen: 'PRIORITY', data: { priority_level: 'C7' } });
  });

  test('the Flow declares the two keys and shows the notes read-only above the picks', () => {
    const priority = buildEvidenceCheckFlow().screens.find((s) => s.id === 'PRIORITY');
    expect(priority.data.notes_v).toMatchObject({ type: 'boolean' });
    expect(priority.data.notes_body).toMatchObject({ type: 'string' });
    const kids = priority.layout.children[0].children;
    const body = kids.findIndex((c) => c.type === 'TextBody' && c.text === '${data.notes_body}');
    const pick = kids.findIndex((c) => c.name === 'priority_final');
    expect(body).toBeGreaterThanOrEqual(0);
    expect(body).toBeLessThan(pick);
    expect(kids[body].visible).toBe('${data.notes_v}');
    expect(kids.filter((c) => c.visible === '${data.notes_v}').map((c) => c.type)).toEqual(['TextSubheading', 'TextBody']);
    // Read-only: nothing on the screen posts the notes back.
    const footer = kids.find((c) => c.type === 'Footer');
    expect(Object.keys(footer['on-click-action'].payload)).not.toContain('notes_body');
  });
});
