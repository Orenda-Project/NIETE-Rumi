/**
 * /observe2: what the coach typed during the lesson reaches the debrief (pilot sheet R13, 14 Oct).
 *
 * Riffat: coaches type evidence in each snapshot's boxes, then it "disappears after the form is saved",
 * so they keep separate notes and write it all again. On prod 35 of 83 checked visits carried a typed
 * note and in none of them did any note reach the brief, the debrief guide, the report or the portal.
 *
 * The brief (it is the debrief guide, in the chat and in the portal) now carries every note, grouped by
 * part, word for word: Part 1 and Part 2's "Anything else" and "Something else", the seal screen's "Not
 * in the recording" and "What happened", and the check's "Why you changed".
 *
 * Real: the check endpoint's Submit, the store, the rules, the brief and the analysis. Mocked: the
 * database (in-memory) and WhatsApp.
 */
const { createFakeSupabase } = require('./helpers/fake-supabase');

let mockFake;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendFlow: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/observe/observe-debrief.service', () => ({
  displayTimeZone: () => 'Asia/Karachi',
  acknowledgeFormSubmitted: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/child-test/conversation/offer', () => ({ sendOffer: jest.fn(() => Promise.resolve(false)) }));

const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const Check = require('../../bot/shared/routes/observe2-check-endpoint');
const { buildBrief } = require('../../bot/shared/services/observe/observe2/brief');
const { CODES } = require('../../bot/shared/services/observe/observe2/fico17');

const token = (id) => `coach-1:observe2-check:${id}`;
const row = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);
const cp = (s) => [...String(s)].length;

const NOTES = {
  p1_notes: '8 min: board wiped before the children had copied it',
  p1_listen_other: 'one child did the whole chart',
  p2_notes: '27 min: three children at the back had no task',
  p2_listen_other: 'they argued about the answer',
  note: 'The back rows could not see the board',
  detail: '31 min: "you never get anything right"',
};
const ANSWERS = {
  present: '32', p1_spoke: '6', p1_picked: 'once', p1_groups: 'alone', p1_listen: ['turns'], p1_materials: 'teacher', p1_change: 'yes', p1_change_how: 'slow',
  p2_spoke: '10', p2_new: '5', p2_picked: 'often', p2_groups: 'combine', p2_listen: ['once'], p2_materials: 'children', p2_change: 'no',
  incident: 'ridicule', lp: 'used', priority: 'C8', ...NOTES,
};
const WHY = 'The moment at 12:40 showed real group work, so I changed it';
const MOMENTS = [
  { id: 'ask_1', moment: 'ask', type: 'open_q_one', minute: '00:40', quote: 'Why do plants need sunlight? Ali?', label: 'open question' },
  { id: 'wrong_1', moment: 'wrong', type: 'wrong_ignored', minute: '05:10', quote: 'No, that is wrong. Who else?', label: 'wrong answer left' },
];

async function checkable(answers = ANSWERS) {
  const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: {} });
  Object.assign(row(form.id), {
    period_minutes: 40, answers, sealed_at: '2026-09-30T05:39:00.000Z', part1_done_at: 'x', part2_done_at: 'x',
    coaching_session_id: 'sess-1', rumi_moments: { moments: MOMENTS, counts: {} }, moments_ready_at: '2026-09-30T05:50:00.000Z',
  });
  return form.id;
}

const heard = (screen) => {
  const out = { screen };
  for (let i = 1; i <= 8; i += 1) out[`${screen.toLowerCase()}_${i}`] = i === 1 ? 'yes' : '';
  return out;
};

async function submit(id, priority) {
  for (const s of ['HEARD_ASK', 'HEARD_WRONG', 'HEARD_WORK', 'HEARD_EXPLAIN']) {
    // eslint-disable-next-line no-await-in-loop
    await Check.handleObserve2CheckDataExchange(token(id), s, heard(s));
  }
  await Check.handleObserve2CheckDataExchange(token(id), 'ADDED_ONE', { screen: 'ADDED_ONE', C1_final: '3', C2_final: '1', C3_final: '3', C6_final: '2', D1_final: '3', D2_final: '4', D4_final: 'IE', D5_final: '1' });
  await Check.handleObserve2CheckDataExchange(token(id), 'ADDED_TWO', { screen: 'ADDED_TWO', C4_final: '1', C5_final: '2', C7_final: '3', C8_final: '2', D3_final: '2', F1_final: '3', F2_final: '2', F3_final: '2', F4_final: '1' });
  return Check.handleObserve2CheckDataExchange(token(id), 'PRIORITY', { screen: 'PRIORITY', ...priority });
}

const storedBrief = () => mockFake.__tables.coaching_sessions[0].analysis_data.observe2.brief;

beforeEach(() => {
  jest.clearAllMocks();
  mockFake = createFakeSupabase({
    users: [
      { id: 'coach-1', phone_number: '923000000001', name: 'Coach', preferred_language: 'en' },
      { id: 'teacher-1', phone_number: '923000000002', name: 'Rabia', preferred_language: 'en' },
    ],
    coaching_sessions: [{ id: 'sess-1', status: 'observe2_checking' }],
  });
});

describe('the brief carries every note the coach typed', () => {
  test('Submit: the brief kept as the debrief guide has each note, word for word, grouped by part', async () => {
    const id = await checkable();
    const done = await submit(id, { priority_final: 'C7', why: WHY });
    expect(done.screen).toBe('DONE');
    const brief = storedBrief();
    const order = ['Your notes', NOTES.p1_notes, NOTES.p1_listen_other, NOTES.p2_notes, NOTES.p2_listen_other, NOTES.note, NOTES.detail, WHY];
    for (const text of order) expect(brief).toContain(text);
    const at = order.map((t) => brief.indexOf(t));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // Each note sits under the part it was typed in.
    expect(brief.indexOf('Part 1')).toBeLessThan(brief.indexOf(NOTES.p1_notes));
    expect(brief.indexOf('Part 2')).toBeGreaterThan(brief.indexOf(NOTES.p1_listen_other));
    expect(brief.indexOf('Part 2')).toBeLessThan(brief.indexOf(NOTES.p2_notes));
    expect(brief.indexOf('Not in the recording')).toBeLessThan(brief.indexOf(NOTES.note));
  });

  test('the notes come after the thing to work on first and before the closing line', async () => {
    const id = await checkable();
    await submit(id, { priority_final: 'C7', why: WHY });
    const brief = storedBrief();
    const work = brief.indexOf('Work on first');
    const notes = brief.indexOf('Your notes');
    const saved = brief.indexOf('Your full record');
    expect([work, notes, saved].every((i) => i >= 0)).toBe(true);
    expect(work).toBeLessThan(notes);
    expect(notes).toBeLessThan(saved);
  });

  test('a visit with no notes has no notes heading', async () => {
    const plain = { ...ANSWERS };
    for (const k of Object.keys(NOTES)) delete plain[k];
    plain.incident = 'none';
    const id = await checkable(plain);
    await submit(id, { priority_final: 'C8' });
    expect(storedBrief()).not.toContain('Your notes');
  });
});

describe('the Urdu brief', () => {
  test('the notes are there word for word, each on its own line under an Urdu label', () => {
    const form = { answers: ANSWERS, rumi_moments: { moments: MOMENTS }, evidence_review: { priority_final: 'C7', why: WHY }, final_levels: { C7: '1', C3: '3' } };
    const text = buildBrief(form, { teacherName: 'Rabia', lang: 'ur' });
    for (const note of [...Object.values(NOTES), WHY]) {
      // Its own line: an English note inside an Urdu message takes its own direction (language-protocol §9).
      expect(text.split('\n')).toContain(note);
    }
    expect(text).not.toContain('Your notes');
    expect(text).not.toMatch(/undefined|null|NaN/);
  });
});

describe('the brief still fits one WhatsApp message', () => {
  test.each(['en', 'ur'])('%s: every box full (600) and a long name stays within 4,096 code points', (lang) => {
    const long = 'x'.repeat(600);
    const answers = { ...ANSWERS, p1_notes: long, p2_notes: long, note: long, detail: long, p1_listen_other: 'y'.repeat(80), p2_listen_other: 'y'.repeat(80) };
    const final = Object.fromEntries(CODES.map((c) => [c, '3']));
    const form = { answers, rumi_moments: { moments: MOMENTS }, evidence_review: { priority_final: 'C2', why: long, heard_wrong_1: 'yes' }, final_levels: { ...final, C2: '1' } };
    const text = buildBrief(form, { teacherName: 'A teacher with a very long name indeed, for this test', lang });
    expect(cp(text)).toBeLessThanOrEqual(4096);
    expect(text).toContain('…');
  });
});
