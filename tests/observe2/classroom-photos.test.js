/**
 * /observe2 — classroom photos: taken now, or uploaded from the photos already on the phone
 * (Riffat, sandbox, 4 Oct 2026: "a coach takes pictures at several moments in the class; besides
 * Take photo there should be an upload option, both should be allowed").
 *
 * WhatsApp shows a photo picker's gallery choice on phones, but on WhatsApp Web and Desktop it shows
 * only "Take photo", and that opens nothing (seen in the round-2 and round-3 runs and in Riffat's
 * screenshot). A file picker opens a file chooser everywhere (round 3 attached the plan PDF through
 * it). Meta allows one picker per screen, so the photos get their own step, the way an added lesson
 * plan does: "How will you add photos?" → take them (photo picker) / upload saved ones (file picker,
 * images only) / no photos → the seal screen, which says how many were added.
 *
 * Real: the Flow builder, the endpoint, the store, the rules. Mocked: the database (in-memory),
 * WhatsApp, the CDN decrypt and the bucket.
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
  decryptMedia: jest.fn((m) => Promise.resolve({ mediaId: m.media_id, fileName: m.file_name, data: Buffer.from(`img:${m.media_id}`) })),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn((buf, key) => Promise.resolve(`https://r2.example/${key}`)),
}));
jest.mock('../../bot/shared/services/observe/observe-debrief.service', () => ({ displayTimeZone: () => 'Asia/Karachi' }));

const { uploadBuffer } = require('../../bot/shared/storage/r2');
const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const Endpoint = require('../../bot/shared/routes/observe2-form-endpoint');
const { buildFieldFormFlow } = require('../../bot/shared/services/observe/observe2/field-form.flow');

const token = (formId) => `coach-1:observe2-form:${formId}`;
const row = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);
// Twelve photos are decrypted and stored one by one after the reply: enough turns for all of them,
// so none lands in the next test's database.
const flush = async () => { for (let i = 0; i < 200; i += 1) await new Promise((r) => setImmediate(r)); };
const media = (n) => ({ media_id: `m${n}`, file_name: `p${n}.jpg`, cdn_url: 'https://cdn.example/x', encryption_metadata: {} });
const send = (id, screen, data) => Endpoint.handleObserve2FormDataExchange(token(id), screen, { screen, ...data });

const flow = buildFieldFormFlow();
const screens = Object.fromEntries(flow.screens.map((s) => [s.id, s]));
function components(s) {
  const out = [];
  const walk = (list) => {
    for (const c of list || []) {
      out.push(c);
      if (c.children) walk(c.children);
      if (c.then) walk(c.then);
      if (c.else) walk(c.else);
    }
  };
  walk(s.layout.children);
  return out;
}
const pickers = (s) => components(s).filter((c) => ['PhotoPicker', 'DocumentPicker'].includes(c.type));

async function planned(patch = {}) {
  const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: {} });
  Object.assign(row(form.id), {
    period_minutes: 40, part1_done_at: 'x', part2_done_at: 'x', answers: { present: '30', p1_spoke: '5', p2_spoke: '8', p2_new: '3', lp: 'none' },
  }, patch);
  return form.id;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFake = createFakeSupabase({ users: [{ id: 'coach-1', phone_number: '923000000001', preferred_language: 'en', role: 'coach' }] });
});

describe('the Flow', () => {
  test('a photo step after the plan: take them, upload saved ones, or none; then the seal', () => {
    expect(flow.screens.map((s) => s.id)).toEqual(['PART_ONE', 'PART_TWO', 'LESSON_PLAN', 'LP_PHOTOS', 'LP_FILE', 'LP_TEXT', 'PHOTOS', 'PHOTO_TAKE', 'PHOTO_FILES', 'AFTER', 'SEALED', 'CONTINUE']);
    expect(flow.routing_model).toMatchObject({
      LESSON_PLAN: ['LP_PHOTOS', 'LP_FILE', 'LP_TEXT', 'PHOTOS'],
      LP_PHOTOS: ['PHOTOS'], LP_FILE: ['PHOTOS'], LP_TEXT: ['PHOTOS'],
      PHOTOS: ['PHOTO_TAKE', 'PHOTO_FILES', 'AFTER'], PHOTO_TAKE: ['AFTER'], PHOTO_FILES: ['AFTER'],
      CONTINUE: ['PART_TWO', 'LESSON_PLAN', 'PHOTOS', 'AFTER', 'SEALED'],
    });
    const how = components(screens.PHOTOS).find((c) => c.name === 'photo_how');
    expect(how).toMatchObject({ type: 'RadioButtonsGroup', required: true });
    expect(how['data-source'].map((o) => o.id)).toEqual(['take', 'files', 'none']);
  });

  test('taking photos: the photo picker, camera or gallery, up to ten', () => {
    expect(pickers(screens.PHOTO_TAKE)).toEqual([expect.objectContaining({
      type: 'PhotoPicker', name: 'photos', 'photo-source': 'camera_gallery', 'min-uploaded-photos': 1, 'max-uploaded-photos': 10,
    })]);
    expect(pickers(screens.PHOTO_TAKE)[0]['max-file-size-kb']).toBeLessThanOrEqual(10240);
  });

  test('uploading saved photos: the file picker, images only, up to ten (it opens a chooser on every client)', () => {
    const [p] = pickers(screens.PHOTO_FILES);
    expect(pickers(screens.PHOTO_FILES)).toHaveLength(1);
    expect(p).toMatchObject({ type: 'DocumentPicker', name: 'photo_files', 'min-uploaded-documents': 1, 'max-uploaded-documents': 10 });
    expect(p['allowed-mime-types']).toEqual(['image/jpeg', 'image/png']);
    expect(p['max-file-size-kb']).toBeLessThanOrEqual(10240);
  });

  test('the seal screen has no picker any more; it says how many photos were added', () => {
    expect(pickers(screens.AFTER)).toEqual([]);
    expect(components(screens.AFTER).some((c) => c.text === '${data.photo_line}')).toBe(true);
    expect(screens.AFTER.data.photo_line).toBeDefined();
  });

  test('each picker\'s value travels only on its own screen\'s data_exchange', () => {
    const footer = (s) => components(s).find((c) => c.type === 'Footer')['on-click-action'];
    expect(footer(screens.PHOTO_TAKE)).toEqual({ name: 'data_exchange', payload: { screen: 'PHOTO_TAKE', photos: '${form.photos}' } });
    expect(footer(screens.PHOTO_FILES)).toEqual({ name: 'data_exchange', payload: { screen: 'PHOTO_FILES', photo_files: '${form.photo_files}' } });
    expect(footer(screens.PHOTOS)).toEqual({ name: 'data_exchange', payload: { screen: 'PHOTOS', photo_how: '${form.photo_how}' } });
  });
});

describe('the endpoint', () => {
  test('a plan picked (or "no plan") leads to the photo step, not straight to the seal', async () => {
    const id = await planned({ answers: { present: '30', p1_spoke: '5', p2_spoke: '8', p2_new: '3' } });
    expect((await send(id, 'LESSON_PLAN', { lp: 'none' })).screen).toBe('PHOTOS');
  });

  test('a choice is needed', async () => {
    const id = await planned();
    const out = await send(id, 'PHOTOS', {});
    expect(out.screen).toBe('PHOTOS');
    expect(out.data.error_messages.photo_how).toBeTruthy();
  });

  test('"Upload saved photos": stored after the reply under the visit\'s own keys; the seal screen counts them', async () => {
    const id = await planned();
    expect((await send(id, 'PHOTOS', { photo_how: 'files' })).screen).toBe('PHOTO_FILES');
    const none = await send(id, 'PHOTO_FILES', { photo_files: [] });
    expect(none.screen).toBe('PHOTO_FILES');
    expect(none.data.error_messages.photo_files).toBeTruthy();
    const out = await send(id, 'PHOTO_FILES', { photo_files: [media(1), media(2), media(3)] });
    expect(out.screen).toBe('AFTER');
    expect(out.data.photo_line).toMatch(/3 photos added/);
    await flush();
    expect(uploadBuffer.mock.calls.map((c) => c[1])).toEqual([1, 2, 3].map((n) => `observe2/${id}/photo-${n}.jpg`));
    expect(row(id).photos).toEqual([1, 2, 3].map((n) => `observe2/${id}/photo-${n}.jpg`));
    expect(row(id).answers).toMatchObject({ photo_how: 'files', photo_count: 3 });
  });

  test('"Take photos now": at most ten kept', async () => {
    const id = await planned();
    expect((await send(id, 'PHOTOS', { photo_how: 'take' })).screen).toBe('PHOTO_TAKE');
    const out = await send(id, 'PHOTO_TAKE', { photos: Array.from({ length: 12 }, (_, i) => media(i + 1)) });
    expect(out.data.photo_line).toMatch(/10 photos added/);
    await flush();
    expect(row(id).photos).toHaveLength(10);
  });

  test('"No photos" goes to the seal and says so', async () => {
    const id = await planned({ photos: ['observe2/old/photo-1.jpg'] });
    const out = await send(id, 'PHOTOS', { photo_how: 'none' });
    expect(out.screen).toBe('AFTER');
    expect(out.data.photo_line).toMatch(/No photos/);
    expect(row(id).photos).toEqual([]);
  });

  test('a reopened form whose photo step was never answered goes back to it', async () => {
    const id = await planned();
    expect((await send(id, 'CONTINUE', {})).screen).toBe('PHOTOS');
    await send(id, 'PHOTOS', { photo_how: 'none' });
    expect((await send(id, 'CONTINUE', {})).screen).toBe('AFTER');
  });

  test('a form opened before this change still seals with the photos it carries', async () => {
    const id = await planned({ answers: { present: '30', p1_spoke: '5', p2_spoke: '8', p2_new: '3', lp: 'none', photo_how: 'none' } });
    const out = await send(id, 'AFTER', { incident: 'none', detail: '', note: '', priority: 'C8', seal_ok: true, photos: [media(1), media(2)] });
    expect(out.screen).toBe('SEALED');
    await flush();
    expect(row(id).photos).toEqual([`observe2/${id}/photo-1.jpg`, `observe2/${id}/photo-2.jpg`]);
  });
});
