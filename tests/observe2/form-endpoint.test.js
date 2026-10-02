/**
 * /observe2 — the live form's endpoint (POST /api/flows/observe2-form).
 *
 * What a coach experiences, screen by screen: a new form opens on Part 1 naming the teacher and
 * the halfway minute; "Part 1 done" is refused with a message under the field when a number is
 * impossible, and saved (with the server time) when it is right; a reopened form continues where
 * the record stands; "Seal and send" seals once, keeps up to three photos, and sends the
 * recording steps in the chat.
 *
 * The store, the rules and the endpoint run for real over an in-memory database; WhatsApp, the
 * CDN decrypt and the bucket are mocked at the network boundary.
 */
const { createFakeSupabase } = require('./helpers/fake-supabase');

let mockFake;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendFlow: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/roster/roster-media', () => ({
  decryptMedia: jest.fn((m) => Promise.resolve({ mediaId: m.media_id, fileName: m.file_name, data: Buffer.from(`jpeg:${m.media_id}`) })),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn((buf, key) => Promise.resolve(`https://r2.example/${key}`)),
}));
jest.mock('../../bot/shared/services/observe/observe-debrief.service', () => ({ displayTimeZone: () => 'Asia/Karachi' }));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const { uploadBuffer } = require('../../bot/shared/storage/r2');
const { decryptMedia } = require('../../bot/shared/services/roster/roster-media');
const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const Endpoint = require('../../bot/shared/routes/observe2-form-endpoint');

const token = (formId, userId = 'coach-1') => `${userId}:observe2-form:${formId}`;
const row = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);
const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r)); };

async function newForm(patch = {}) {
  const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: { teacher_ext_id: 'tx1' } });
  Object.assign(row(form.id), { period_minutes: 40 }, patch);
  return form.id;
}

const PART_1_OK = {
  screen: 'PART_ONE', present: '32', p1_spoke: '6', p1_picked: 'once', p1_groups: 'alone', p1_listen: ['turns'],
  p1_listen_other: '', p1_materials: 'teacher', p1_change: 'yes', p1_change_how: 'slow', p1_notes: '8 min: board wiped',
};
const PART_2_OK = {
  screen: 'PART_TWO', p2_spoke: '10', p2_new: '5', p2_picked: 'often', p2_groups: 'combine', p2_listen: ['once'],
  p2_listen_other: '', p2_materials: 'children', p2_change: 'no', p2_notes: '',
};
const PLAN_NONE = { screen: 'LESSON_PLAN', lp: 'none' };
const AFTER_OK = { screen: 'AFTER', incident: 'none', detail: '', note: '', priority: 'C8', seal_ok: true };
const photo = (n) => ({ media_id: `m${n}`, file_name: `p${n}.jpg`, cdn_url: 'https://cdn.example/x', encryption_metadata: {} });

beforeEach(() => {
  jest.clearAllMocks();
  mockFake = createFakeSupabase({
    users: [
      { id: 'coach-1', phone_number: '923000000001', name: 'Coach', preferred_language: 'en', role: 'coach' },
      { id: 'teacher-1', phone_number: '923000000002', name: 'Rabia', preferred_language: 'en', role: 'teacher' },
    ],
  });
});

describe('opening the form', () => {
  test('a new form opens on Part 1, naming the teacher and the halfway minute', async () => {
    const id = await newForm();
    const out = await Endpoint.handleObserve2FormInit(token(id));
    expect(out.screen).toBe('PART_ONE');
    expect(out.data.teacher_line).toContain('Rabia');
    expect(out.data.part_hint).toMatch(/minute 20/);
    expect(out.data).toMatchObject({ error_messages: {}, error: '', has_error: false });
    expect(row(id).opened_at).toBeTruthy();
  });

  test('a form reopened after Part 1 continues with Part 2', async () => {
    const id = await newForm({ part1_done_at: '2026-09-30T05:20:00.000Z' });
    const out = await Endpoint.handleObserve2FormInit(token(id));
    expect(out.screen).toBe('CONTINUE');
    expect(out.data.continue_heading).toBe('Part 1 is saved');
    expect(out.data.continue_line).toMatch(/Part 2/);
  });

  test('a sealed form says so, and cannot be filled again', async () => {
    const id = await newForm({ part1_done_at: 'x', part2_done_at: 'x', sealed_at: '2026-09-30T05:39:00.000Z' });
    const out = await Endpoint.handleObserve2FormInit(token(id));
    expect(out.screen).toBe('CONTINUE');
    expect(out.data.continue_heading).toMatch(/sealed/i);
    expect(out.data.continue_line).toMatch(/10:39/);
  });

  test("another coach's token never opens the form", async () => {
    const id = await newForm();
    const out = await Endpoint.handleObserve2FormInit(token(id, 'coach-2'));
    expect(out.screen).toBe('CONTINUE');
    expect(out.data.continue_heading).toMatch(/not available/i);
    expect(row(id).opened_at).toBeUndefined();
  });
});

describe('Part 1 and Part 2', () => {
  test('an impossible number is refused under its field, and nothing is saved', async () => {
    const id = await newForm();
    const out = await Endpoint.handleObserve2FormDataExchange(token(id), 'PART_ONE', { ...PART_1_OK, p1_spoke: '40' });
    expect(out.screen).toBe('PART_ONE');
    expect(out.data.error_messages.p1_spoke).toBeTruthy();
    expect(out.data.has_error).toBe(true);
    expect(row(id).part1_done_at).toBeUndefined();
  });

  test('"Part 1 done" saves the part with the server time and opens Part 2', async () => {
    const id = await newForm();
    const out = await Endpoint.handleObserve2FormDataExchange(token(id), 'PART_ONE', PART_1_OK);
    expect(out.screen).toBe('PART_TWO');
    expect(out.data.part_hint).toMatch(/minute 20 to 40/);
    expect(row(id).answers).toMatchObject({ present: '32', p1_spoke: '6', p1_listen: ['turns'] });
    expect(row(id).part1_done_at).toBeTruthy();
  });

  test('Part 2 is checked against Part 1: more first-time speakers than silent children is refused', async () => {
    const id = await newForm();
    await Endpoint.handleObserve2FormDataExchange(token(id), 'PART_ONE', PART_1_OK);
    const out = await Endpoint.handleObserve2FormDataExchange(token(id), 'PART_TWO', { ...PART_2_OK, p2_spoke: '30', p2_new: '27' });
    expect(out.screen).toBe('PART_TWO');
    expect(out.data.error_messages.p2_new).toMatch(/26/);
  });

  test('"Part 2 done" saves and opens the lesson plan (2 Oct: the plan is picked before the seal)', async () => {
    const id = await newForm();
    await Endpoint.handleObserve2FormDataExchange(token(id), 'PART_ONE', PART_1_OK);
    const out = await Endpoint.handleObserve2FormDataExchange(token(id), 'PART_TWO', PART_2_OK);
    expect(out.screen).toBe('LESSON_PLAN');
    expect(row(id).part2_done_at).toBeTruthy();
  });
});

describe('the seal', () => {
  async function toAfter() {
    const id = await newForm();
    await Endpoint.handleObserve2FormDataExchange(token(id), 'PART_ONE', PART_1_OK);
    await Endpoint.handleObserve2FormDataExchange(token(id), 'PART_TWO', PART_2_OK);
    await Endpoint.handleObserve2FormDataExchange(token(id), 'LESSON_PLAN', PLAN_NONE);
    return id;
  }

  test('without the tick, nothing is sealed', async () => {
    const id = await toAfter();
    const out = await Endpoint.handleObserve2FormDataExchange(token(id), 'AFTER', { ...AFTER_OK, seal_ok: false });
    expect(out.screen).toBe('AFTER');
    expect(out.data.error_messages.seal_ok).toBeTruthy();
    expect(row(id).sealed_at).toBeUndefined();
  });

  test('"Seal and send" seals, answers with the sealed screen, sends the recording steps, keeps the photos', async () => {
    const id = await toAfter();
    const out = await Endpoint.handleObserve2FormDataExchange(token(id), 'AFTER', { ...AFTER_OK, photos: [photo(1), photo(2)] });
    expect(out.screen).toBe('SEALED');
    expect(out.data.sealed_line).toMatch(/^Sealed at \d{2}:\d{2}$/);
    expect(out.data.record_id).toBe(id);
    expect(row(id).sealed_at).toBeTruthy();
    expect(row(id).answers).toMatchObject({ present: '32', p2_new: '5', lp: 'none', priority: 'C8' });

    await flush();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    const [to, text] = WhatsAppService.sendMessage.mock.calls[0];
    expect(to).toBe('923000000001');
    expect(text).toMatch(/recorder/i);
    expect(uploadBuffer.mock.calls.map((c) => c[1])).toEqual([`observe2/${id}/photo-1.jpg`, `observe2/${id}/photo-2.jpg`]);
    expect(row(id).photos).toEqual([`observe2/${id}/photo-1.jpg`, `observe2/${id}/photo-2.jpg`]);
  });

  test('a second tap finds it sealed: the same screen, no second message', async () => {
    const id = await toAfter();
    await Endpoint.handleObserve2FormDataExchange(token(id), 'AFTER', AFTER_OK);
    const again = await Endpoint.handleObserve2FormDataExchange(token(id), 'AFTER', { ...AFTER_OK, priority: 'F1' });
    expect(again.screen).toBe('SEALED');
    await flush();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    expect(row(id).answers.priority).toBe('C8');
  });

  test('the recording came first: sealing opens the check straight away', async () => {
    process.env.OBSERVE2_CHECK_FLOW_ID = 'F-CHECK';
    try {
      const id = await toAfter();
      Object.assign(row(id), { coaching_session_id: 'sess-1', moments_ready_at: '2026-09-30T05:30:00.000Z', rumi_moments: { moments: [{ id: 'ask_1' }, { id: 'ask_2' }] } });
      await Endpoint.handleObserve2FormDataExchange(token(id), 'AFTER', AFTER_OK);
      await flush();
      expect(WhatsAppService.sendFlow).toHaveBeenCalledWith('923000000001', expect.objectContaining({ flowId: 'F-CHECK', flowToken: `coach-1:observe2-check:${id}` }));
      const [, text] = WhatsAppService.sendMessage.mock.calls[0];
      expect(text).not.toMatch(/stop the recorder/i);
      expect(text).toMatch(/recording is already in/i);
    } finally { delete process.env.OBSERVE2_CHECK_FLOW_ID; }
  });

  test('the recording has not come yet: no check at the seal', async () => {
    const id = await toAfter();
    await Endpoint.handleObserve2FormDataExchange(token(id), 'AFTER', AFTER_OK);
    await flush();
    expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
  });

  test('never more than ten photos are kept (no teachers\' cap of three for coaches, 2 Oct)', async () => {
    const id = await toAfter();
    await Endpoint.handleObserve2FormDataExchange(token(id), 'AFTER', { ...AFTER_OK, photos: Array.from({ length: 11 }, (_, i) => photo(i + 1)) });
    await flush();
    expect(decryptMedia).toHaveBeenCalledTimes(10);
    expect(row(id).photos).toHaveLength(10);
  });
});

describe('Continue, on a reopened form', () => {
  test.each([
    [{ part1_done_at: 'x' }, 'PART_TWO'],
    [{ part1_done_at: 'x', part2_done_at: 'x' }, 'LESSON_PLAN'],
    [{ part1_done_at: 'x', part2_done_at: 'x', answers: { lp: 'none' } }, 'AFTER'],
    [{ part1_done_at: 'x', part2_done_at: 'x', sealed_at: '2026-09-30T05:39:00.000Z' }, 'SEALED'],
  ])('%j goes on to %s', async (patch, next) => {
    const id = await newForm(patch);
    const out = await Endpoint.handleObserve2FormDataExchange(token(id), 'CONTINUE', { screen: 'CONTINUE' });
    expect(out.screen).toBe(next);
  });
});
