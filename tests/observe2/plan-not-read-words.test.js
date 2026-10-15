/**
 * /observe2: when a plan the coach added really can't be read, the coach is told THAT, and what to do
 * next (bd-eal7zn.2, pilot sheet rows R6/R7; workspace Rule 24d).
 *
 * In the pilot a coach who added the teacher's plan as a PDF was told, in the brief, that "what was
 * added didn't read as a lesson plan". The debrief form's Section B said "No lesson plan was provided
 * for this observation", because its fallback knew only two states and every other one fell through
 * to "none provided". Both named the wrong state. A plan WAS added. It couldn't be read, or no lesson
 * steps were found in it. And neither said what to do next time.
 *
 * Driven through the live path: the moments run grades the added plan (real added-plan, real
 * orchestrator), the brief is built from the stored record, the analysis /observe2 hands to the
 * debrief is built from it, and the debrief form's Section B is pre-filled from that analysis exactly
 * as the Flow endpoint and the portal do. Mocked at the boundary: the database, WhatsApp, R2, the
 * file reader and the model calls.
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
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn((b, key) => { mockR2[key] = b; return Promise.resolve(`https://r2.example/${key}`); }),
  downloadFromR2: jest.fn((key) => (mockR2[key] ? Promise.resolve(mockR2[key]) : Promise.reject(new Error('NoSuchKey')))),
}));
jest.mock('../../bot/shared/services/observe/observe-debrief.service', () => ({ displayTimeZone: () => 'Asia/Karachi' }));

const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const Moments = require('../../bot/shared/services/observe/observe2/moments');
const { buildBrief } = require('../../bot/shared/services/observe/observe2/brief');
const { buildAnalysis } = require('../../bot/shared/services/observe/observe2/analysis');
const { buildScreenPrefill } = require('../../bot/shared/services/observe/observe-draft.service');

const TRANSCRIPT = ['[00:10] Teacher: Open your books.', '[00:42] Teacher: Who can read the first line?'].join('\n\n');
const MODEL_OUT = { moments: [{ moment: 'ask', type: 'open_q_one', minute: '00:42', quote: 'Who can read the first line?' }], counts: {} };
const PART_1 = { present: '30', p1_spoke: '6', p1_picked: 'once', p1_groups: 'none', p1_materials: 'teacher', p1_change: 'no' };
const PART_2 = { p2_spoke: '8', p2_new: '3', p2_picked: 'often', p2_groups: 'combine', p2_listen: ['once'], p2_materials: 'children', p2_change: 'no' };
const formRow = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);

const prevMode = process.env.OBSERVE_FICO_FLOW_HAS_FIDELITY;
beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(mockR2)) delete mockR2[k];
  process.env.LP_FIDELITY_ENABLED = 'true';
  process.env.OBSERVE_FICO_FLOW_HAS_FIDELITY = 'editable'; // prod's value: the debrief form's Section B shows fid_fallback
  mockFake = createFakeSupabase({
    users: [
      { id: 'coach-1', phone_number: '923000000001', name: 'Coach', preferred_language: 'en', role: 'coach' },
      { id: 'teacher-1', phone_number: '923000000002', name: 'Test Teacher', preferred_language: 'en', role: 'teacher' },
    ],
  });
});
afterAll(() => {
  delete process.env.LP_FIDELITY_ENABLED;
  if (prevMode === undefined) delete process.env.OBSERVE_FICO_FLOW_HAS_FIDELITY;
  else process.env.OBSERVE_FICO_FLOW_HAS_FIDELITY = prevMode;
});

/** A sealed visit whose added plan is one file, graded by the moments run with the given reader. */
async function gradedWith(text, isPlan) {
  const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: {} });
  const key = `observe2/${form.id}/plan-1`;
  mockR2[key] = Buffer.from('%PDF-1.4 a plan the teacher typed');
  Object.assign(formRow(form.id), {
    period_minutes: 40,
    sealed_at: '2026-10-13T07:00:00.000Z',
    answers: { ...PART_1, ...PART_2, incident: 'none', priority: 'C1', lp: 'used', lp_pick: 'upload', lp_how: 'file', lp_upload: { kind: 'file', count: 1, keys: [key] } },
  });
  mockFake.__tables.coaching_sessions = [{ id: 'sess-1', status: 'transcription_complete', transcript_text: TRANSCRIPT, audio_duration_seconds: 2400, observation_type: 'leader_observation', observer_user_id: 'coach-1', user_id: 'teacher-1' }];
  await Store.linkSession(form.id, 'sess-1');
  await Moments.runForSession('sess-1', '923000000001', {
    llm: () => Promise.resolve(MODEL_OUT),
    fidelityDeps: { analyzeFidelity: jest.fn(), extractUploadedLp: jest.fn() },
    planDeps: {
      detectFileType: () => 'pdf',
      extractText: () => Promise.resolve({ text, parser: 'pdf-parse' }),
      structure: () => Promise.resolve({ is_lesson_plan: isPlan }),
    },
  });
  return { ...formRow(form.id), final_levels: {}, evidence_review: { priority_final: 'C1' } };
}

const NEXT_EN = /Next time, pick the teacher's plan from the list in the form, or add a clear photo of each page\./;
const NEXT_UR = /اگلی بار فارم کی فہرست سے استاد کا منصوبہ چنیں/;
const sectionB = (form) => buildScreenPrefill(buildAnalysis(form, { brief: buildBrief(form) }), 'lesson_plan_fidelity', 'en');

describe('a plan that could not be read', () => {
  test('the brief says the file couldn\'t be read, and what to do next time', async () => {
    const form = await gradedWith('', true);
    expect(form.rumi_moments.fidelity.status).toBe('lp_unreadable');
    const en = buildBrief(form, { lang: 'en' });
    expect(en).toMatch(/The lesson plan: the file or photos you added couldn't be read, so the lesson wasn't checked against the plan\./);
    expect(en).toMatch(NEXT_EN);
    const ur = buildBrief(form, { lang: 'ur' });
    expect(ur).toMatch(/پڑھی نہیں جا سکیں/);
    expect(ur).toMatch(NEXT_UR);
    expect(ur).not.toMatch(/undefined|null/);
  });

  test('the debrief form\'s Section B says the plan was added but couldn\'t be read, never "no lesson plan was provided"', async () => {
    const form = await gradedWith('', true);
    const d = sectionB(form);
    expect(d.no_fidelity).toBe(true);
    expect(d.fid_fallback).not.toMatch(/No lesson plan was provided/);
    expect(d.fid_fallback).toMatch(/A lesson plan was added, but its file or photos could not be read/);
    expect(d.fid_fallback).toMatch(NEXT_EN);
    expect(d.fid_fallback).toMatch(/not scored/);
  });
});

describe('what was added had no lesson steps in it', () => {
  test('the brief says no lesson steps were found in what was added, and what to do next time', async () => {
    const form = await gradedWith('Dear Principal, I request leave for two days. Yours sincerely.', false);
    expect(form.rumi_moments.fidelity.status).toBe('lp_not_lesson_plan');
    const en = buildBrief(form, { lang: 'en' });
    expect(en).not.toMatch(/didn't read as a lesson plan/);
    expect(en).toMatch(/The lesson plan: no lesson steps were found in what you added, so the lesson wasn't checked against the plan\./);
    expect(en).toMatch(NEXT_EN);
    const ur = buildBrief(form, { lang: 'ur' });
    expect(ur).toMatch(/سبق کے مراحل نہیں ملے/);
    expect(ur).toMatch(NEXT_UR);
  });

  test('the debrief form\'s Section B says a file was added but no lesson steps were found in it', async () => {
    const form = await gradedWith('Dear Principal, I request leave for two days. Yours sincerely.', false);
    const d = sectionB(form);
    expect(d.fid_fallback).not.toMatch(/No lesson plan was provided/);
    expect(d.fid_fallback).toMatch(/A file was added as the lesson plan, but no lesson steps were found in it/);
    expect(d.fid_fallback).toMatch(NEXT_EN);
  });

  test('a visit with no plan at all still says no plan was provided', () => {
    const d = buildScreenPrefill({ framework: 'fico', lp_fidelity: { status: 'lp_absent' }, domains: {} }, 'lesson_plan_fidelity', 'en');
    expect(d.fid_fallback).toMatch(/No lesson plan was provided/);
    expect(d.fid_fallback).not.toMatch(/Next time/);
  });
});
