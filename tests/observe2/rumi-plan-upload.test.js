/**
 * /observe2: a coach uploads, as a file, a lesson plan that IS one of Rumi's own plans (bd-eal7zn.2,
 * pilot sheet rows R6/R7).
 *
 * In the pilot, most files coaches upload are byte-for-byte a plan PDF Rumi itself made: the teacher's
 * copy, forwarded to the coach. Read like any other file, an Urdu plan's text layer comes out of the
 * PDF parser as broken glyphs, the "is this a lesson plan?" check says no, and the plan is never
 * graded; the coach is told the plan didn't read as a plan. Rumi doesn't need to read its own plan:
 * the file's bytes name it (niete_lp_assets.content_hash = the first 12 hex of the PDF's SHA-1, the
 * asset's own definition). Such a file is linked to that plan and graded from Rumi's own steps,
 * exactly like a plan picked from the list. Anything else is read as before.
 *
 * Real: the endpoints, the store, the moments module, added-plan, the fidelity orchestrator, the move
 * store and the scorer, the brief. Mocked at the boundary: the database (in-memory), WhatsApp, R2,
 * the file reader and the model calls.
 */
const crypto = require('crypto');
const { createFakeSupabase } = require('./helpers/fake-supabase');

let mockFake;
const mockR2 = {};
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendFlow: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn((b, key) => { mockR2[key] = b; return Promise.resolve(`https://r2.example/${key}`); }),
  downloadFromR2: jest.fn((key) => (mockR2[key] ? Promise.resolve(mockR2[key]) : Promise.reject(new Error('NoSuchKey')))),
}));
jest.mock('../../bot/shared/services/observe/observe-debrief.service', () => ({ displayTimeZone: () => 'Asia/Karachi' }));

const { logToFile } = require('../../bot/shared/utils/logger');
const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const Check = require('../../bot/shared/routes/observe2-check-endpoint');
const Moments = require('../../bot/shared/services/observe/observe2/moments');
const { buildBrief } = require('../../bot/shared/services/observe/observe2/brief');

const LESSON = 'grade_2_urdu_ch9_seg4';
// Fixture bytes standing in for a rendered Rumi plan PDF: only their hash is ever looked at.
const RUMI_PDF = Buffer.from('%PDF-1.5\n% fixture: a Grade 2 Urdu plan as Rumi renders it\n');
const sha12 = (buf) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12);
// What the PDF parser returns for an Urdu plan's text layer: glyphs broken up by NUL bytes.
const GLYPH_SOUP = 'ﻗ\u0000ﻮ\u0000ا\u0000ﻋ\u0000ﺪ\u0000 \u0000ﻓ\u0000ﻌ\u0000ﻞ\u0000 '.repeat(400);

const TRANSCRIPT = [
  '[00:10] Teacher: آج ہم فعل کے زمانے پڑھیں گے۔',
  '[00:42] Teacher: یہ کام کب ہوا؟ ماضی، حال یا مستقبل؟',
  '[01:16] Teacher: اپنے ساتھی کے ساتھ تین جملے بنائیں۔',
].join('\n\n');
const MODEL_OUT = { moments: [{ moment: 'ask', type: 'open_q_one', minute: '00:42', quote: 'یہ کام کب ہوا؟' }], counts: {} };
const RUMI_MOVES = [
  { move_id: 'm1', phase: 'warm_up', bucket: 'must_happen', text: 'Name the three tenses with one sentence each.' },
  { move_id: 'm2', phase: 'practice', bucket: 'must_happen', text: 'Pairs write three sentences, one per tense.' },
];
const GRADED = {
  verdicts: [
    { move_id: 'm1', verdict: 'executed', evidence: '[00:42] یہ کام کب ہوا؟', rationale: 'Asked.' },
    { move_id: 'm2', verdict: 'executed', evidence: '[01:16] اپنے ساتھی کے ساتھ تین جملے بنائیں۔', rationale: 'Done.' },
  ],
  moderators: { plan_navigability: null, note: null },
  narrative: 'The plan was taught.',
  model: 'test-grader',
};
const PART_1 = { present: '30', p1_spoke: '6', p1_picked: 'once', p1_groups: 'none', p1_materials: 'teacher', p1_change: 'no' };
const PART_2 = { p2_spoke: '8', p2_new: '3', p2_picked: 'often', p2_groups: 'combine', p2_listen: ['once'], p2_materials: 'children', p2_change: 'no' };

const formRow = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);
const asset = (over = {}) => ({
  id: 'asset-u94', lesson_id: LESSON, asset_kind: 'lesson', version_stamp: 'title_9Oct', content_hash: sha12(RUMI_PDF),
  is_current: true, superseded_at: null, created_at: '2026-10-10T05:05:28.000Z', ...over,
});
const moveRow = (over = {}) => ({
  id: 'mv-1', lesson_id: LESSON, version_stamp: 'title_9Oct', content_hash: sha12(RUMI_PDF), template: 'V8',
  total_minutes: 40, moves: RUMI_MOVES, created_at: '2026-10-10T06:00:00.000Z', ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(mockR2)) delete mockR2[k];
  process.env.LP_FIDELITY_ENABLED = 'true';
  delete process.env.LP_FIDELITY_RUNS;
  process.env.OBSERVE2_CHECK_FLOW_ID = 'F-CHECK';
  mockFake = createFakeSupabase({
    users: [
      { id: 'coach-1', phone_number: '923000000001', name: 'Coach', preferred_language: 'en', role: 'coach' },
      { id: 'teacher-1', phone_number: '923000000002', name: 'Test Teacher', preferred_language: 'en', role: 'teacher' },
    ],
    niete_lp_assets: [asset()],
    niete_lp_fidelity_moves: [moveRow()],
  });
});
afterAll(() => { delete process.env.LP_FIDELITY_ENABLED; delete process.env.OBSERVE2_CHECK_FLOW_ID; });

async function sealedWithFiles(buffers) {
  const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: {} });
  const keys = buffers.map((_, i) => `observe2/${form.id}/plan-${i + 1}`);
  buffers.forEach((b, i) => { mockR2[keys[i]] = b; });
  Object.assign(formRow(form.id), {
    period_minutes: 40,
    sealed_at: '2026-10-13T07:00:00.000Z',
    answers: { ...PART_1, ...PART_2, incident: 'none', priority: 'C1', lp: 'used', lp_pick: 'upload', lp_how: 'file', lp_upload: { kind: 'file', count: keys.length, keys } },
  });
  mockFake.__tables.coaching_sessions = [{ id: 'sess-1', status: 'transcription_complete', transcript_text: TRANSCRIPT, audio_duration_seconds: 2400, observation_type: 'leader_observation', observer_user_id: 'coach-1', user_id: 'teacher-1' }];
  await Store.linkSession(form.id, 'sess-1');
  return form.id;
}

// The reader as it behaves on prod for an Urdu Rumi plan PDF: a text layer of glyph soup, which the
// "is this a lesson plan?" call rejects.
const deps = () => ({
  llm: () => Promise.resolve(MODEL_OUT),
  fidelityDeps: { analyzeFidelity: jest.fn(() => Promise.resolve(GRADED)), extractUploadedLp: jest.fn(() => Promise.resolve({ goal: 'x', moves: RUMI_MOVES })) },
  planDeps: {
    detectFileType: jest.fn(() => 'pdf'),
    extractText: jest.fn((buf) => Promise.resolve({ text: buf.length ? GLYPH_SOUP : '', parser: 'pdf-parse' })),
    structure: jest.fn(() => Promise.resolve({ is_lesson_plan: false })),
  },
});

describe('a file that is one of Rumi\'s own plans is linked to that plan, not read', () => {
  test('an Urdu Rumi plan PDF is graded from Rumi\'s own steps, like a pick: no reading, no "is this a plan?" call', async () => {
    const id = await sealedWithFiles([RUMI_PDF]);
    const d = deps();
    const out = await Moments.runForSession('sess-1', '923000000001', d);
    expect(out.action).toBe('check_sent');

    expect(d.planDeps.extractText).not.toHaveBeenCalled();
    expect(d.planDeps.structure).not.toHaveBeenCalled();
    expect(d.fidelityDeps.extractUploadedLp).not.toHaveBeenCalled();

    const fid = formRow(id).rumi_moments.fidelity;
    expect(fid).toMatchObject({ status: 'ok', source: 'corpus', lesson_id: LESSON, prescribed_count: 2, fidelity_pct: 100 });
    expect(fid.plan_source).toMatchObject({
      kind: 'file', files: 1, rumi_plan: { asset_id: 'asset-u94', lesson_id: LESSON, version_stamp: 'title_9Oct', content_hash: sha12(RUMI_PDF) },
    });
    // The grader got Rumi's own steps for that plan.
    expect(d.fidelityDeps.analyzeFidelity.mock.calls[0][0].map((m) => m.move_id)).toEqual(['m1', 'm2']);
    expect(logToFile).toHaveBeenCalledWith(expect.stringMatching(/one of the bot's own plans/), expect.objectContaining({ lessonId: LESSON }));

    // The coach's brief gives the plan's result, and the check opens the plan's steps.
    const brief = buildBrief({ ...formRow(id), final_levels: {}, evidence_review: { priority_final: 'C1' } }, { lang: 'en' });
    expect(brief).toMatch(/The lesson plan: 2 of 2 planned steps done \(100%\)/);
    mockFake.__tables.coaching_sessions[0].status = 'observe2_checking';
    for (const s of ['HEARD_ASK', 'HEARD_WRONG', 'HEARD_WORK']) {
      // eslint-disable-next-line no-await-in-loop
      await Check.handleObserve2CheckDataExchange(`coach-1:observe2-check:${id}`, s, { screen: s });
    }
    const fidScreen = await Check.handleObserve2CheckDataExchange(`coach-1:observe2-check:${id}`, 'HEARD_EXPLAIN', { screen: 'HEARD_EXPLAIN' });
    expect(fidScreen.screen).toBe('FIDELITY');
    expect(fidScreen.data.mv_1).toMatch(/Name the three tenses/);
  });

  test('a plan version with no step list of its own is graded from the lesson\'s current steps (as a pick is)', async () => {
    mockFake.__tables.niete_lp_fidelity_moves = [moveRow({ version_stamp: 'elec_9Oct', content_hash: 'other0000001' })];
    const id = await sealedWithFiles([RUMI_PDF]);
    const d = deps();
    await Moments.runForSession('sess-1', '923000000001', d);
    expect(d.planDeps.extractText).not.toHaveBeenCalled();
    const fid = formRow(id).rumi_moments.fidelity;
    expect(fid).toMatchObject({ status: 'ok', source: 'corpus', lesson_id: LESSON });
    expect(fid.meta.version_drift).toBe(true);
  });

  test('the one-page plan card Rumi sends is linked to its lesson too', async () => {
    mockFake.__tables.niete_lp_assets = [asset({ id: 'card-u94', asset_kind: 'card', version_stamp: 'v10card_prod_14Oct' })];
    const id = await sealedWithFiles([RUMI_PDF]);
    const d = deps();
    await Moments.runForSession('sess-1', '923000000001', d);
    expect(d.planDeps.extractText).not.toHaveBeenCalled();
    expect(formRow(id).rumi_moments.fidelity).toMatchObject({ status: 'ok', source: 'corpus', lesson_id: LESSON });
    expect(formRow(id).rumi_moments.fidelity.plan_source.rumi_plan).toMatchObject({ asset_id: 'card-u94', lesson_id: LESSON });
  });

  test('with several files, the one that is Rumi\'s plan names the plan', async () => {
    const id = await sealedWithFiles([Buffer.from('a photo of the board'), RUMI_PDF]);
    const d = deps();
    await Moments.runForSession('sess-1', '923000000001', d);
    expect(d.planDeps.extractText).not.toHaveBeenCalled();
    expect(formRow(id).rumi_moments.fidelity).toMatchObject({ status: 'ok', source: 'corpus', lesson_id: LESSON });
  });
});

describe('anything else is read as before', () => {
  test('a file that is not one of Rumi\'s plans is read and checked', async () => {
    const id = await sealedWithFiles([Buffer.from('%PDF-1.4 a plan the teacher typed in Word')]);
    const d = deps();
    d.planDeps.extractText = jest.fn(() => Promise.resolve({ text: 'Warm-up: tenses. Practice: three sentences in pairs. Exit: one sentence each.', parser: 'pdf-parse' }));
    d.planDeps.structure = jest.fn(() => Promise.resolve({ is_lesson_plan: true, objectives: ['tenses'], activities: ['pairs'] }));
    await Moments.runForSession('sess-1', '923000000001', d);
    expect(d.planDeps.extractText).toHaveBeenCalledTimes(1);
    expect(d.fidelityDeps.extractUploadedLp).toHaveBeenCalledTimes(1);
    expect(formRow(id).rumi_moments.fidelity).toMatchObject({ status: 'ok', source: 'uploaded' });
    expect(formRow(id).rumi_moments.fidelity.plan_source.rumi_plan).toBeUndefined();
  });

  test('an empty file is never matched (three broken assets carry the hash of empty bytes)', async () => {
    const empty = Buffer.alloc(0);
    mockFake.__tables.niete_lp_assets.push(asset({ id: 'broken-1', lesson_id: 'grade_1_maths_ch5_seg9', content_hash: sha12(empty) }));
    const id = await sealedWithFiles([empty]);
    const d = deps();
    await Moments.runForSession('sess-1', '923000000001', d);
    expect(formRow(id).rumi_moments.fidelity.status).toBe('lp_unreadable');
    expect(formRow(id).rumi_moments.fidelity.plan_source.rumi_plan).toBeUndefined();
  });

  test('bytes that match two different lessons name no plan: read as before', async () => {
    mockFake.__tables.niete_lp_assets.push(asset({ id: 'asset-other', lesson_id: 'grade_4_math_ch4_seg990' }));
    await sealedWithFiles([RUMI_PDF]);
    const d = deps();
    await Moments.runForSession('sess-1', '923000000001', d);
    expect(d.planDeps.extractText).toHaveBeenCalledTimes(1);
  });

  test('when Rumi\'s plans cannot be looked up, the file is read as before and the failure is logged', async () => {
    const id = await sealedWithFiles([RUMI_PDF]);
    const d = deps();
    // Any query on the plans table answers with an error, however it is chained.
    const failing = () => {
      const api = new Proxy({}, {
        get: (_, prop) => (prop === 'then' ? (resolve) => resolve({ data: null, error: { message: 'boom' } }) : () => api),
      });
      return api;
    };
    const realFrom = mockFake.from;
    mockFake.from = (table) => (table === 'niete_lp_assets' ? failing() : realFrom(table));
    await Moments.runForSession('sess-1', '923000000001', d);
    expect(d.planDeps.extractText).toHaveBeenCalledTimes(1);
    expect(formRow(id).rumi_moments.fidelity.status).toBe('lp_not_lesson_plan');
    expect(logToFile).toHaveBeenCalledWith(expect.stringMatching(/the bot's own plans could not be looked up/), expect.any(Object), 'error');
  });
});
