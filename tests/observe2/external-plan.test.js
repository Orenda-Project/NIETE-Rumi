/**
 * /observe2: a lesson plan the bot didn't give the teacher. The coach adds it inside the form, before
 * the seal, as photos of the paper plan, a PDF or Word file, or typed text. After the recording it is
 * read and graded the way /observe grades an uploaded plan: the extraction worker's reader (pdf text
 * layer, Word, vision OCR for photos and scanned PDFs), the same "is this a lesson plan?" check, then
 * the fidelity orchestrator's uploaded-plan path (extractUploadedLp → grader → scorer).
 *
 * The plan list is named the way /observe's picker names it (lp-selection-format), and its last row is
 * /observe's "Upload new".
 *
 * Real: the endpoints, the store, the rules, the moments module, the recent-plan source, the fidelity
 * orchestrator and scorer, the brief. Mocked at the boundary: the database (in-memory), WhatsApp,
 * R2, Flow media decryption, the file reader and the model calls.
 */
const { createFakeSupabase } = require('./helpers/fake-supabase');

let mockFake;
const mockR2 = {};
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendFlow: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/roster/roster-media', () => ({
  decryptMedia: jest.fn((m) => Promise.resolve({ mediaId: m.media_id, data: Buffer.from(`bytes:${m.media_id}`) })),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn((b, key) => { mockR2[key] = b; return Promise.resolve(`https://r2.example/${key}`); }),
  downloadFromR2: jest.fn((key) => (mockR2[key] ? Promise.resolve(mockR2[key]) : Promise.reject(new Error('NoSuchKey')))),
}));
jest.mock('../../bot/shared/services/observe/observe-debrief.service', () => ({ displayTimeZone: () => 'Asia/Karachi' }));

const { decryptMedia } = require('../../bot/shared/services/roster/roster-media');
const { uploadBuffer } = require('../../bot/shared/storage/r2');
const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const Form = require('../../bot/shared/routes/observe2-form-endpoint');
const Check = require('../../bot/shared/routes/observe2-check-endpoint');
const Moments = require('../../bot/shared/services/observe/observe2/moments');
const { buildFieldFormFlow } = require('../../bot/shared/services/observe/observe2/field-form.flow');
const { buildBrief } = require('../../bot/shared/services/observe/observe2/brief');
const { formatLpRow } = require('../../bot/shared/services/coaching/lp-coaching/lp-selection-format');

const LESSON = 'grade_4_math_ch5_seg3';
const VERSION = { version_stamp: 'v8-20260817T0809', content_hash: '0a1cd51499a1' };
const TRANSCRIPT = [
  '[00:10] Teacher: What do you notice about the two strips?',
  '[00:42] Teacher: Why is two quarters the same as one half? Hamza?',
  '[01:16] Teacher: Put three quarters next to one half. What do you see?',
  '[01:38] Teacher: Now work with your partner. You can choose.',
].join('\n\n');
const MODEL_OUT = { moments: [{ moment: 'ask', type: 'open_q_one', minute: '00:42', quote: 'Why is two quarters the same as one half? Hamza?' }], counts: {} };
const TYPED = 'Warm-up: show two fraction strips and ask what the children notice. Then compare 1/2 and 3/4 by folding. Pairs order three fractions on a number line. Exit ticket: which is bigger, 2/3 or 3/5?';
const UPLOADED_MOVES = {
  goal: 'Compare fractions',
  moves: [
    { move_id: 'm1', phase: 'warm_up', bucket: 'must_happen', text: 'Show two fraction strips and ask what the children notice.' },
    { move_id: 'm2', phase: 'explain', bucket: 'must_happen', text: 'Compare 1/2 and 3/4 by folding.' },
  ],
};
const GRADED = {
  verdicts: [
    { move_id: 'm1', verdict: 'executed', evidence: '[00:10] What do you notice about the two strips?', rationale: 'Shown and asked.' },
    { move_id: 'm2', verdict: 'partial', evidence: '[01:16] Put three quarters next to one half.', rationale: 'Compared, without folding.' },
  ],
  moderators: { plan_navigability: null, note: null },
  narrative: 'Most of the plan was taught.',
  model: 'test-grader',
};
const A_PLAN = { is_lesson_plan: true, subject: 'Mathematics', objectives: ['Compare fractions'], activities: ['Fold strips'] };

const formRow = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);
const formToken = (id) => `coach-1:observe2-form:${id}`;
const flush = async () => { for (let i = 0; i < 30; i += 1) await new Promise((r) => setImmediate(r)); };
const cp = (s) => [...String(s)].length;

function walk(node, visit) {
  if (Array.isArray(node)) node.forEach((c) => walk(c, visit));
  else if (node && typeof node === 'object') {
    if (node.type) visit(node);
    for (const k of ['children', 'then', 'else']) if (Array.isArray(node[k])) walk(node[k], visit);
  }
}
const comps = (screen) => { const out = []; walk(screen.layout.children, (c) => out.push(c)); return out; };

const PART_1 = { screen: 'PART_ONE', present: '30', p1_spoke: '6', p1_picked: 'once', p1_groups: 'none', p1_materials: 'teacher', p1_change: 'no' };
const PART_2 = { screen: 'PART_TWO', p2_spoke: '8', p2_new: '3', p2_picked: 'often', p2_groups: 'combine', p2_listen: ['once'], p2_materials: 'children', p2_change: 'no' };

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(mockR2)) delete mockR2[k];
  process.env.LP_FIDELITY_ENABLED = 'true';
  delete process.env.LP_FIDELITY_RUNS;
  process.env.OBSERVE2_CHECK_FLOW_ID = 'F-CHECK';
  mockFake = createFakeSupabase({
    users: [
      { id: 'coach-1', phone_number: '923000000001', name: 'Coach', preferred_language: 'en', role: 'coach' },
      { id: 'teacher-1', phone_number: '923000000002', name: 'Rabia', preferred_language: 'en', role: 'teacher' },
    ],
    niete_lp_downloads: [
      { user_id: 'teacher-1', asset_id: 'asset-3', lesson_id: LESSON, ...VERSION, grade: 4, subject: 'math', chapter_number: 5, status: 'sent', created_at: '2026-10-02T08:00:00.000Z' },
      { user_id: 'teacher-1', asset_id: 'asset-2', lesson_id: 'grade_4_math_ch5_seg2', version_stamp: 'v8-x', content_hash: 'h2', grade: 4, subject: 'math', chapter_number: 5, status: 'sent', created_at: '2026-10-01T08:00:00.000Z' },
    ],
  });
});
afterAll(() => { delete process.env.LP_FIDELITY_ENABLED; delete process.env.OBSERVE2_CHECK_FLOW_ID; });

async function newForm(patch = {}) {
  const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: { teacher_ext_id: 'tx1' } });
  Object.assign(formRow(form.id), { period_minutes: 40 }, patch);
  return form.id;
}

async function throughPart2(id) {
  await Form.handleObserve2FormInit(formToken(id));
  await Form.handleObserve2FormDataExchange(formToken(id), 'PART_ONE', PART_1);
  return Form.handleObserve2FormDataExchange(formToken(id), 'PART_TWO', PART_2);
}
const plan = (id, data) => Form.handleObserve2FormDataExchange(formToken(id), 'LESSON_PLAN', { screen: 'LESSON_PLAN', ...data });

// ------------------------------------------------------------------ the form

describe('the form: three ways to add a plan the bot did not give the teacher', () => {
  const flow = buildFieldFormFlow();
  const screens = Object.fromEntries(flow.screens.map((s) => [s.id, s]));

  test('"Upload new" asks how, then opens photos, a file, or typed text; each goes on to the seal', () => {
    expect(flow.screens.map((s) => s.id)).toEqual(['PART_ONE', 'PART_TWO', 'LESSON_PLAN', 'LP_PHOTOS', 'LP_FILE', 'LP_TEXT', 'AFTER', 'SEALED', 'CONTINUE']);
    expect(flow.routing_model.LESSON_PLAN).toEqual(['LP_PHOTOS', 'LP_FILE', 'LP_TEXT', 'AFTER']);
    for (const s of ['LP_PHOTOS', 'LP_FILE', 'LP_TEXT']) expect(flow.routing_model[s]).toEqual(['AFTER']);
    const c = comps(screens.LESSON_PLAN);
    const how = c.find((x) => x.name === 'lp_how');
    expect(how).toMatchObject({ type: 'RadioButtonsGroup' });
    expect(how['data-source'].map((o) => o.id)).toEqual(['photos', 'file', 'text']);
    expect(JSON.stringify(c.filter((x) => x.type === 'If'))).toContain("${form.lp_pick} == 'upload'");
    expect(c.find((x) => x.type === 'Footer')['on-click-action'].payload).toEqual({ screen: 'LESSON_PLAN', lp: '${form.lp}', lp_pick: '${form.lp_pick}', lp_how: '${form.lp_how}' });
  });

  test('photos: one picker, camera or gallery, one page per photo, up to ten', () => {
    const p = comps(screens.LP_PHOTOS).find((x) => x.type === 'PhotoPicker');
    expect(p).toMatchObject({ name: 'lp_photos', 'photo-source': 'camera_gallery', 'min-uploaded-photos': 1, 'max-uploaded-photos': 10 });
    const footer = comps(screens.LP_PHOTOS).find((x) => x.type === 'Footer');
    expect(footer['on-click-action']).toEqual({ name: 'data_exchange', payload: { screen: 'LP_PHOTOS', lp_photos: '${form.lp_photos}' } });
  });

  test('a file: PDF or Word (or a photo saved as a file)', () => {
    const d = comps(screens.LP_FILE).find((x) => x.type === 'DocumentPicker');
    expect(d.name).toBe('lp_file');
    expect(d['allowed-mime-types']).toEqual(expect.arrayContaining([
      'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png',
    ]));
    expect(d['min-uploaded-documents']).toBe(1);
    const footer = comps(screens.LP_FILE).find((x) => x.type === 'Footer');
    expect(footer['on-click-action']).toEqual({ name: 'data_exchange', payload: { screen: 'LP_FILE', lp_file: '${form.lp_file}' } });
  });

  test('typed text: one box, required', () => {
    const t = comps(screens.LP_TEXT).find((x) => x.type === 'TextArea');
    expect(t).toMatchObject({ name: 'lp_text', required: true });
    expect(cp(t.label)).toBeLessThanOrEqual(20);
  });

  test('Meta\'s rule: at most one picker on a screen, and never a photo picker beside a file picker', () => {
    for (const s of flow.screens) {
      if (!s.layout) continue;
      const c = comps(s);
      const photo = c.filter((x) => x.type === 'PhotoPicker').length;
      const doc = c.filter((x) => x.type === 'DocumentPicker').length;
      expect(photo + doc).toBeLessThanOrEqual(1);
    }
  });
});

// ------------------------------------------------------------------ the endpoint

describe('the plan list reads like /observe\'s, and "Upload new" adds a plan', () => {
  test('rows are named exactly as /observe\'s plan picker names them; the last row is "Upload new"', async () => {
    const id = await newForm();
    const out = await throughPart2(id);
    const opts = out.data.lp_options;
    expect(opts.map((o) => o.id)).toEqual(['asset-3', 'asset-2', 'upload']);
    const rows = mockFake.__tables.niete_lp_downloads.filter((r) => r.user_id === 'teacher-1');
    const { getRecentFidelityLps } = require('../../bot/shared/services/coaching/lp-coaching/recent-fidelity-lps.service');
    const recent = await getRecentFidelityLps('teacher-1');
    expect(recent.length).toBe(rows.length);
    for (let i = 0; i < recent.length; i += 1) {
      const f = formatLpRow(recent[i]);
      expect(opts[i]).toEqual({ id: String(recent[i].id), title: f.title, description: f.description });
      expect(cp(opts[i].title)).toBeLessThanOrEqual(24);
    }
    expect(opts[2]).toMatchObject({ id: 'upload', title: 'Upload new' });
    expect(opts[2].description).toMatch(/photo/i);
    expect(JSON.stringify(out.data)).not.toMatch(/Not in this list/);
    expect(out.data.lp_hint).toMatch(/Upload new/);
  });

  test('a plan must be picked, and "Upload new" must say how', async () => {
    const id = await newForm();
    await throughPart2(id);
    let out = await plan(id, { lp: 'used', lp_pick: '' });
    expect(out.data.error).toBe('Pick the plan, or "Upload new".');
    out = await plan(id, { lp: 'used', lp_pick: 'upload', lp_how: '' });
    expect(out.screen).toBe('LESSON_PLAN');
    expect(out.data.error_messages.lp_how).toBeTruthy();
    expect(out.data.error).toBe(out.data.error_messages.lp_how);
  });

  test('"Upload new" opens the screen for the way chosen, and saves no picked plan', async () => {
    const id = await newForm();
    await throughPart2(id);
    expect((await plan(id, { lp: 'used', lp_pick: 'upload', lp_how: 'photos' })).screen).toBe('LP_PHOTOS');
    expect((await plan(id, { lp: 'used', lp_pick: 'upload', lp_how: 'file' })).screen).toBe('LP_FILE');
    expect((await plan(id, { lp: 'used', lp_pick: 'upload', lp_how: 'text' })).screen).toBe('LP_TEXT');
    const a = formRow(id).answers;
    expect(a).toMatchObject({ lp: 'used', lp_pick: 'upload', lp_how: 'text' });
    expect(a.lp_ref).toBeUndefined();
  });

  test('photos of the plan: saved in order to their own keys after the reply; the seal screen says how many', async () => {
    const id = await newForm();
    await throughPart2(id);
    await plan(id, { lp: 'used', lp_pick: 'upload', lp_how: 'photos' });
    const none = await Form.handleObserve2FormDataExchange(formToken(id), 'LP_PHOTOS', { screen: 'LP_PHOTOS', lp_photos: [] });
    expect(none.screen).toBe('LP_PHOTOS');
    expect(none.data.error).toMatch(/photo/i);
    const photos = [{ media_id: 'p1' }, { media_id: 'p2' }, { media_id: 'p3' }];
    const out = await Form.handleObserve2FormDataExchange(formToken(id), 'LP_PHOTOS', { screen: 'LP_PHOTOS', lp_photos: photos });
    expect(out.screen).toBe('AFTER');
    expect(out.data.lp_line).toMatch(/3 photos of the plan/);
    expect(out.data.lp_line).toMatch(/go back/i);
    const keys = [1, 2, 3].map((n) => `observe2/${id}/plan-${n}`);
    expect(formRow(id).answers.lp_upload).toMatchObject({ kind: 'photos', count: 3, keys });
    await flush();
    expect(decryptMedia).toHaveBeenCalledTimes(3);
    expect(uploadBuffer.mock.calls.map((c) => c[1])).toEqual(keys);
  });

  test('a file: saved the same way; typed text: kept as typed, nothing to store', async () => {
    const id = await newForm();
    await throughPart2(id);
    await plan(id, { lp: 'used', lp_pick: 'upload', lp_how: 'file' });
    let out = await Form.handleObserve2FormDataExchange(formToken(id), 'LP_FILE', { screen: 'LP_FILE', lp_file: [{ media_id: 'f1', file_name: 'plan.pdf' }] });
    expect(out.screen).toBe('AFTER');
    expect(out.data.lp_line).toMatch(/the file you added/i);
    expect(formRow(id).answers.lp_upload).toMatchObject({ kind: 'file', count: 1, keys: [`observe2/${id}/plan-1`] });

    await plan(id, { lp: 'used', lp_pick: 'upload', lp_how: 'text' });
    out = await Form.handleObserve2FormDataExchange(formToken(id), 'LP_TEXT', { screen: 'LP_TEXT', lp_text: 'Fractions.' });
    expect(out.screen).toBe('LP_TEXT');
    expect(out.data.error_messages.lp_text).toBeTruthy();
    await flush(); // the file above is stored after its reply
    uploadBuffer.mockClear();
    out = await Form.handleObserve2FormDataExchange(formToken(id), 'LP_TEXT', { screen: 'LP_TEXT', lp_text: TYPED });
    expect(out.screen).toBe('AFTER');
    expect(out.data.lp_line).toMatch(/the plan you typed/i);
    expect(formRow(id).answers.lp_upload).toEqual(expect.objectContaining({ kind: 'text', text: TYPED }));
    expect(formRow(id).answers.lp_upload.keys).toBeUndefined();
    await flush();
    expect(uploadBuffer).not.toHaveBeenCalled();
  });

  test('picking a listed plan drops an added one, and adding one drops a listed pick', async () => {
    const id = await newForm();
    await throughPart2(id);
    await plan(id, { lp: 'used', lp_pick: 'upload', lp_how: 'text' });
    await Form.handleObserve2FormDataExchange(formToken(id), 'LP_TEXT', { screen: 'LP_TEXT', lp_text: TYPED });
    await plan(id, { lp: 'used', lp_pick: 'asset-3' });
    let a = formRow(id).answers;
    expect(a.lp_ref.lesson_id).toBe(LESSON);
    expect(a.lp_upload).toBeUndefined();
    expect(a.lp_how).toBeUndefined();
    await plan(id, { lp: 'used', lp_pick: 'upload', lp_how: 'text' });
    a = formRow(id).answers;
    expect(a.lp_ref).toBeUndefined();
  });

  test('a form reopened before the added plan was sent goes back to the plan screen', async () => {
    const id = await newForm();
    await throughPart2(id);
    await plan(id, { lp: 'used', lp_pick: 'upload', lp_how: 'photos' });
    const init = await Form.handleObserve2FormInit(formToken(id));
    expect(init.screen).toBe('CONTINUE');
    expect((await Form.handleObserve2FormDataExchange(formToken(id), 'CONTINUE', { screen: 'CONTINUE' })).screen).toBe('LESSON_PLAN');
  });
});

// ------------------------------------------------------------------ grading

describe('an added plan is read and graded the way /observe grades an uploaded plan', () => {
  async function sealedWith(lpUpload) {
    const id = await newForm({
      sealed_at: '2026-10-02T10:00:00.000Z',
      answers: { ...PART_1, ...PART_2, incident: 'none', priority: 'C1', lp: 'used', lp_pick: 'upload', lp_how: lpUpload.kind, lp_upload: lpUpload },
    });
    mockFake.__tables.coaching_sessions = [{ id: 'sess-1', status: 'transcription_complete', transcript_text: TRANSCRIPT, audio_duration_seconds: 215, observation_type: 'leader_observation', observer_user_id: 'coach-1', user_id: 'teacher-1' }];
    await Store.linkSession(id, 'sess-1');
    return id;
  }
  const deps = (over = {}) => ({
    llm: () => Promise.resolve(MODEL_OUT),
    fidelityDeps: { analyzeFidelity: jest.fn(() => Promise.resolve(GRADED)), extractUploadedLp: jest.fn(() => Promise.resolve(UPLOADED_MOVES)) },
    planDeps: {
      detectFileType: jest.fn((buf) => (String(buf).includes('pdf') ? 'pdf' : 'jpg')),
      extractText: jest.fn((buf) => Promise.resolve({ text: `text of ${String(buf)}`, parser: 'vision:image' })),
      structure: jest.fn(() => Promise.resolve(A_PLAN)),
    },
    ...over,
  });

  test('typed text goes to the uploaded-plan path, and the check shows its steps', async () => {
    const id = await sealedWith({ kind: 'text', text: TYPED });
    const d = deps();
    const out = await Moments.runForSession('sess-1', '923000000001', d);
    expect(out.action).toBe('check_sent');
    expect(d.planDeps.structure).toHaveBeenCalledWith(TYPED);
    expect(d.fidelityDeps.extractUploadedLp).toHaveBeenCalledTimes(1);
    expect(d.fidelityDeps.extractUploadedLp.mock.calls[0][0]).toBe(TYPED);
    const fid = formRow(id).rumi_moments.fidelity;
    expect(fid).toMatchObject({ status: 'ok', source: 'uploaded', prescribed_count: 2, fidelity_pct: 75 });
    expect(fid.plan_source).toMatchObject({ kind: 'text' });
    // The check opens the plan screen for an added plan exactly as for a listed one.
    mockFake.__tables.coaching_sessions[0].status = 'observe2_checking';
    for (const s of ['HEARD_ASK', 'HEARD_WRONG', 'HEARD_WORK']) {
      // eslint-disable-next-line no-await-in-loop
      await Check.handleObserve2CheckDataExchange(`coach-1:observe2-check:${id}`, s, { screen: s });
    }
    const fidScreen = await Check.handleObserve2CheckDataExchange(`coach-1:observe2-check:${id}`, 'HEARD_EXPLAIN', { screen: 'HEARD_EXPLAIN' });
    expect(fidScreen.screen).toBe('FIDELITY');
    expect(fidScreen.data.mv_1).toMatch(/^Step 1 of 2 · Warm-up: Show two fraction strips/);
  });

  test('photos are read page by page, in order, and graded as one plan', async () => {
    const id = await newForm();
    mockR2[`observe2/${id}/plan-1`] = Buffer.from('page one');
    mockR2[`observe2/${id}/plan-2`] = Buffer.from('page two');
    Object.assign(formRow(id), {
      sealed_at: '2026-10-02T10:00:00.000Z',
      answers: { ...PART_1, ...PART_2, incident: 'none', priority: 'C1', lp: 'used', lp_pick: 'upload', lp_how: 'photos', lp_upload: { kind: 'photos', count: 2, keys: [`observe2/${id}/plan-1`, `observe2/${id}/plan-2`] } },
    });
    mockFake.__tables.coaching_sessions = [{ id: 'sess-1', status: 'transcription_complete', transcript_text: TRANSCRIPT, audio_duration_seconds: 215, observation_type: 'leader_observation', observer_user_id: 'coach-1', user_id: 'teacher-1' }];
    await Store.linkSession(id, 'sess-1');
    const d = deps();
    await Moments.runForSession('sess-1', '923000000001', d);
    expect(d.planDeps.extractText.mock.calls.map((c) => String(c[0]))).toEqual(['page one', 'page two']);
    expect(d.planDeps.extractText.mock.calls.map((c) => c[1])).toEqual(['jpg', 'jpg']);
    const text = d.fidelityDeps.extractUploadedLp.mock.calls[0][0];
    expect(text.indexOf('text of page one')).toBeLessThan(text.indexOf('text of page two'));
    expect(formRow(id).rumi_moments.fidelity).toMatchObject({ status: 'ok', source: 'uploaded' });
    expect(formRow(id).rumi_moments.fidelity.plan_source).toMatchObject({ kind: 'photos', files: 2, read: 2 });
  });

  test('what was added is not a lesson plan: not graded, with its own status, and the brief says so', async () => {
    const id = await sealedWith({ kind: 'text', text: TYPED });
    const d = deps();
    d.planDeps.structure = jest.fn(() => Promise.resolve({ is_lesson_plan: false }));
    await Moments.runForSession('sess-1', '923000000001', d);
    expect(d.fidelityDeps.extractUploadedLp).not.toHaveBeenCalled();
    expect(formRow(id).rumi_moments.fidelity).toMatchObject({ status: 'lp_not_lesson_plan' });
    const brief = buildBrief({ ...formRow(id), final_levels: {}, evidence_review: { priority_final: 'C1' } }, { lang: 'en' });
    expect(brief).toMatch(/didn't read as a lesson plan/);
    expect(buildBrief({ ...formRow(id), final_levels: {}, evidence_review: { priority_final: 'C1' } }, { lang: 'ur' })).not.toMatch(/undefined|null/);
  });

  test('photos that could not be read: not graded, and the brief says the plan could not be read', async () => {
    const id = await newForm();
    Object.assign(formRow(id), {
      sealed_at: '2026-10-02T10:00:00.000Z',
      answers: { ...PART_1, ...PART_2, incident: 'none', priority: 'C1', lp: 'used', lp_pick: 'upload', lp_how: 'photos', lp_upload: { kind: 'photos', count: 1, keys: [`observe2/${id}/plan-1`] } },
    });
    mockFake.__tables.coaching_sessions = [{ id: 'sess-1', status: 'transcription_complete', transcript_text: TRANSCRIPT, audio_duration_seconds: 215, observation_type: 'leader_observation', observer_user_id: 'coach-1', user_id: 'teacher-1' }];
    await Store.linkSession(id, 'sess-1');
    const d = deps();
    await Moments.runForSession('sess-1', '923000000001', d);
    expect(d.fidelityDeps.extractUploadedLp).not.toHaveBeenCalled();
    expect(formRow(id).rumi_moments.fidelity).toMatchObject({ status: 'lp_unreadable' });
    expect(formRow(id).rumi_moments.fidelity.plan_source).toMatchObject({ kind: 'photos', files: 1, read: 0 });
    const brief = buildBrief({ ...formRow(id), final_levels: {}, evidence_review: { priority_final: 'C1' } }, { lang: 'en' });
    expect(brief).toMatch(/couldn't be read/);
  });

  test('a listed plan is still graded from the bot\'s own steps, with no file reading', async () => {
    const id = await newForm({
      sealed_at: '2026-10-02T10:00:00.000Z',
      answers: { ...PART_1, ...PART_2, incident: 'none', priority: 'C1', lp: 'used', lp_pick: 'asset-3', lp_ref: { asset_id: 'asset-3', lesson_id: LESSON, ...VERSION, grade: '4', subject: 'math', label: 'x' } },
    });
    mockFake.__tables.coaching_sessions = [{ id: 'sess-1', status: 'transcription_complete', transcript_text: TRANSCRIPT, audio_duration_seconds: 215, observation_type: 'leader_observation', observer_user_id: 'coach-1', user_id: 'teacher-1' }];
    await Store.linkSession(id, 'sess-1');
    const d = deps();
    await Moments.runForSession('sess-1', '923000000001', d);
    expect(d.planDeps.extractText).not.toHaveBeenCalled();
    expect(d.planDeps.structure).not.toHaveBeenCalled();
    expect(d.fidelityDeps.extractUploadedLp).not.toHaveBeenCalled();
    expect(formRow(id).rumi_moments.fidelity.status).not.toBe('lp_unreadable');
  });
});

// ------------------------------------------------------------------ photo evidence, as /observe

describe('the coach\'s classroom photos reach the plan grader the way /observe\'s do', () => {
  afterEach(() => { delete process.env.COACHING_PHOTO_VISION; delete process.env.LP_FIDELITY_PHOTO; });

  async function sealedWithPhotos() {
    const id = await newForm({
      sealed_at: '2026-10-02T10:00:00.000Z',
      answers: { ...PART_1, ...PART_2, incident: 'none', priority: 'C1', lp: 'used', lp_pick: 'upload', lp_how: 'text', lp_upload: { kind: 'text', text: TYPED } },
    });
    formRow(id).photos = [`observe2/${id}/photo-1.jpg`, `observe2/${id}/photo-2.jpg`];
    mockR2[`observe2/${id}/photo-1.jpg`] = Buffer.from('board');
    mockR2[`observe2/${id}/photo-2.jpg`] = Buffer.from('selfie');
    mockFake.__tables.coaching_sessions = [{ id: 'sess-1', status: 'transcription_complete', transcript_text: TRANSCRIPT, audio_duration_seconds: 215, observation_type: 'leader_observation', observer_user_id: 'coach-1', user_id: 'teacher-1' }];
    await Store.linkSession(id, 'sess-1');
    return id;
  }
  const BOARD = { kind: 'board', visible_text: 'half is less than three quarters', drawings: null, students: null, learning_materials: ['fraction strips'], student_work: null };
  const photoDeps = () => ({
    read: jest.fn((buf) => Promise.resolve(String(buf) === 'board'
      ? { ok: true, kind: 'board', exclude: null, evidence: BOARD }
      : { ok: true, kind: 'not_a_classroom_photo', exclude: 'not_a_classroom_photo', evidence: null })),
  });
  const run = (over) => {
    const analyzeFidelity = jest.fn(() => Promise.resolve(GRADED));
    const d = {
      llm: () => Promise.resolve(MODEL_OUT),
      fidelityDeps: { analyzeFidelity, extractUploadedLp: jest.fn(() => Promise.resolve(UPLOADED_MOVES)) },
      planDeps: { structure: jest.fn(() => Promise.resolve(A_PLAN)) },
      photoDeps: photoDeps(),
      ...over,
    };
    return Moments.runForSession('sess-1', '923000000001', d).then(() => d);
  };

  test('with photo evidence on (v2 reading + LP_FIDELITY_PHOTO), each photo is read and a classroom photo goes to the grader, numbered', async () => {
    process.env.COACHING_PHOTO_VISION = 'v2';
    process.env.LP_FIDELITY_PHOTO = 'on';
    const id = await sealedWithPhotos();
    const d = await run();
    expect(d.photoDeps.read).toHaveBeenCalledTimes(2);
    const opts = d.fidelityDeps.analyzeFidelity.mock.calls[0][3];
    expect(opts.photoEvidence).toEqual([expect.objectContaining({ n: 1, kind: 'board', visible_text: 'half is less than three quarters' })]);
    expect(formRow(id).rumi_moments.fidelity.photo_citations).toMatchObject({ photos: 1 });
  });

  test('with photo evidence off, no photo is read and the grader gets none', async () => {
    await sealedWithPhotos();
    const d = await run();
    expect(d.photoDeps.read).not.toHaveBeenCalled();
    expect((d.fidelityDeps.analyzeFidelity.mock.calls[0][3] || {}).photoEvidence).toBeUndefined();
  });
});
