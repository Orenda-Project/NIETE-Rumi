/**
 * /observe2 "Which plan?": the teacher's own plans, including the ones read in the teacher app
 * (bd-eal7zn.2, pilot sheet rows R6, R7, R11).
 *
 * R6/R7: the plan a teacher made the day before was not in the list. Since 12 Oct a teacher who asks
 * for a plan opens it in the app, which writes niete_lp_opens and no niete_lp_downloads row. The list
 * read the downloads only, so it showed the teacher's older WhatsApp plans and not the one just
 * made. (Fixed for every reader of getRecentFidelityLps by 6bd482fa8 / 1212cf26f. This pins it at
 * the /observe2 form, where the coaches met it.)
 *
 * R11: "coaches should pick the teacher's plan from a list instead of asking for the file". The
 * teacher is chosen in the visit planner before the form, so the list is already that teacher's.
 * The screen now says these are the teacher's plans, read in the app too, so the file isn't needed.
 *
 * Real: the form endpoint, the store, the recent-plan source, the app-open reader, the V8 catalogue,
 * the row format. Mocked at the boundary: the database (in-memory), WhatsApp, R2.
 */
const { createFakeSupabase } = require('./helpers/fake-supabase');

let mockFake;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(() => Promise.resolve(true)) }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn(), downloadFromR2: jest.fn() }));
jest.mock('../../bot/shared/services/observe/observe-debrief.service', () => ({ displayTimeZone: () => 'Asia/Karachi' }));

const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const Form = require('../../bot/shared/routes/observe2-form-endpoint');
const V8Catalog = require('../../bot/shared/services/lp-v8-catalog.service');

const TEACHER = 'teacher-1';
const APP_LESSON = 'grade_2_urdu_ch9_seg4';       // read in the app yesterday: no download row
const OLD_LESSON = 'grade_1_urdu_ch8_seg2';       // sent on WhatsApp a week ago
const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const cp = (s) => [...String(s)].length;

const PART_1 = { screen: 'PART_ONE', present: '30', p1_spoke: '6', p1_picked: 'once', p1_groups: 'none', p1_materials: 'teacher', p1_change: 'no' };
const PART_2 = { screen: 'PART_TWO', p2_spoke: '8', p2_new: '3', p2_picked: 'often', p2_groups: 'combine', p2_listen: ['once'], p2_materials: 'children', p2_change: 'no' };
const formToken = (id) => `coach-1:observe2-form:${id}`;

beforeEach(() => {
  jest.clearAllMocks();
  mockFake = createFakeSupabase({
    users: [
      { id: 'coach-1', phone_number: '923000000001', name: 'Coach', preferred_language: 'en', role: 'coach' },
      { id: TEACHER, phone_number: '923000000002', name: 'Test Teacher', preferred_language: 'ur', role: 'teacher' },
    ],
    niete_lp_downloads: [
      { user_id: TEACHER, asset_id: 'asset-old', lesson_id: OLD_LESSON, version_stamp: 'v8-x', content_hash: 'hold00000001', grade: 1, subject: 'urdu', chapter_number: 8, status: 'sent', created_at: hoursAgo(24 * 7) },
    ],
    niete_lp_opens: [
      { id: 'open-1', user_id: TEACHER, plan_kind: 'k5', plan_ref: APP_LESSON, source: 'viewer', opened_at: hoursAgo(30), created_at: hoursAgo(30) },
    ],
    niete_lp_assets: [
      { id: 'asset-app', lesson_id: APP_LESSON, asset_kind: 'lesson', version_stamp: 'title_9Oct', content_hash: 'happ00000001', is_current: true, superseded_at: null, created_at: hoursAgo(24 * 5) },
    ],
  });
});

async function toPlanScreen() {
  const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: TEACHER, visitContext: {} });
  Object.assign(mockFake.__tables.observation_field_forms.find((r) => r.id === form.id), { period_minutes: 40 });
  await Form.handleObserve2FormInit(formToken(form.id));
  await Form.handleObserve2FormDataExchange(formToken(form.id), 'PART_ONE', PART_1);
  return { id: form.id, out: await Form.handleObserve2FormDataExchange(formToken(form.id), 'PART_TWO', PART_2) };
}

describe('"Which plan?" lists the teacher\'s plans read in the app, newest first', () => {
  test('a plan the teacher read in the app yesterday is the first row, named so the coach knows it', async () => {
    const { out } = await toPlanScreen();
    expect(out.screen).toBe('LESSON_PLAN');
    const opts = out.data.lp_options;
    expect(opts.map((o) => o.id)).toEqual(['asset-app', 'asset-old', 'upload']);
    const topic = V8Catalog.lessonById(APP_LESSON).lesson.topic;
    expect(topic.startsWith(opts[0].title.replace(/…$/, ''))).toBe(true);
    expect(opts[0].description).toBe('Grade 2 Urdu · Ch9 Day 4 · p.66-67 · yesterday');
  });

  test('every row fits the Dropdown: title at most 30 code points, description at most 300', async () => {
    const { out } = await toPlanScreen();
    for (const o of out.data.lp_options) {
      expect(cp(o.title)).toBeLessThanOrEqual(30);
      expect(cp(o.description)).toBeLessThanOrEqual(300);
    }
  });

  test('picking it saves the plan the app served, so the visit is graded from that plan\'s steps', async () => {
    const { id } = await toPlanScreen();
    const out = await Form.handleObserve2FormDataExchange(formToken(id), 'LESSON_PLAN', { screen: 'LESSON_PLAN', fv: '4', lp: 'used', lp_pick: 'asset-app' });
    expect(out.screen).toBe('PHOTOS');
    const a = mockFake.__tables.observation_field_forms.find((r) => r.id === id).answers;
    expect(a.lp_ref).toMatchObject({ asset_id: 'asset-app', lesson_id: APP_LESSON, version_stamp: 'title_9Oct', content_hash: 'happ00000001', grade: '2', subject: 'urdu' });
  });
});

describe('R11: the screen tells the coach the file isn\'t needed', () => {
  test('the hint says these are the teacher\'s plans, from the app and WhatsApp, so there is no need to ask for the file', async () => {
    const { out } = await toPlanScreen();
    expect(out.data.lp_hint).toBe("Test Teacher's plans from the app and WhatsApp, newest first. Pick the one taught: there's no need to ask for the file. If it isn't here, pick \"Upload new\".");
  });

  test('a teacher with no plans yet: the hint says so, and how to add the plan', async () => {
    mockFake.__tables.niete_lp_downloads = [];
    mockFake.__tables.niete_lp_opens = [];
    const { out } = await toPlanScreen();
    expect(out.data.lp_options.map((o) => o.id)).toEqual(['upload']);
    expect(out.data.lp_hint).toBe('Test Teacher has no plans from the app or WhatsApp yet. Pick "Upload new" to add the plan.');
  });
});
