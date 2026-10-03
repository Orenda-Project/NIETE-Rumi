/**
 * L21 / bd-s1oo0.28 — "Send to teacher" comes back when the child test is separate from the observation
 * (ISSUES P4). Since 3 Oct /egra stands alone (CHILD_TEST_OBSERVE_LINK unset), so there is no observed
 * teacher and the offer never appeared. The class teacher now comes from the DRAWN class:
 * class_teachers (active; the flagged class teacher first, else any active teacher of that class) →
 * users (a WhatsApp number).
 *   exactly one  → "Send to <first name>"
 *   two or three → one button each; more → a list
 *   none         → no offer, nothing else breaks
 * The teacher's message wording is L19's and is not tested here beyond "one message, to that teacher".
 *
 * Mocked at the network boundary only (WhatsApp, Redis, R2, Supabase); other lanes are contract fakes.
 */
const { createFakeRedis, createWhatsAppRecorder } = require('../L4/helpers/boundary');
const { createFakeSupabase } = require('../../observe2/helpers/fake-supabase');
const { createLaneFakes } = require('../L4/helpers/lane-fakes');

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
const ports = require('../../../bot/shared/services/child-test/conversation/ports');
const H = require('../../../bot/shared/handlers/child-test.handler');

const COACH = { id: '11111111-1111-4111-8111-111111111111', role: 'coach', region: 'niete', preferred_language: 'en', phone_number: '923000000001' };
const PHONE = COACH.phone_number;
const teacher = (n, name, extra = {}) => ({ id: `teacher-${n}`, role: 'teacher', name, preferred_language: 'en', phone_number: `92300000009${n}`, school_id: '22222222-2222-4222-8222-222222222222', ...extra });
const link = (n, classId, extra = {}) => ({ teacher_user_id: `teacher-${n}`, class_id: classId, is_active: true, ...extra });
let lanes;
const SAVED = { ...process.env };

function seedDb({ teachers = [teacher(1, 'Sana Test Teacher')], links = [link(1, 'class-3a', { is_class_teacher: true })] } = {}) {
  mockDb = createFakeSupabase({
    users: [COACH, ...teachers],
    class_teachers: links,
    classes: [
      { id: 'class-3a', grade_code: 'grade_3', section: 'A', school_id: '22222222-2222-4222-8222-222222222222', is_active: true },
      { id: 'class-3b', grade_code: 'grade_3', section: 'B', school_id: '22222222-2222-4222-8222-222222222222', is_active: true },
    ],
    leader_schools: [{ leader_user_id: '11111111-1111-4111-8111-111111111111', school_id: '22222222-2222-4222-8222-222222222222', school_name: 'SIM — School', emis: '111' }],
  });
}

/** Today's list drawn from both sections (the draw may span classes). */
function listSpansTwoClasses() {
  const orig = lanes.draw.todaysList;
  lanes.draw.todaysList = async (args) => {
    const r = await orig(args);
    if (r.ok) { r.classIds = ['class-3a', 'class-3b']; r.children[4].classId = 'class-3b'; }
    return r;
  };
}

const sent = () => mockWa.__sent;
const offers = () => sent().filter((m) => m.kind === 'buttons' && m.buttons.some((b) => b.id.startsWith('ctst_tsend')));
const pickLists = () => sent().filter((m) => m.kind === 'list' && m.action.sections.some((s) => s.rows.some((r) => r.id.startsWith('ctst_tsend'))));
const openList = async (who = COACH) => expect(await H.handleText(PHONE, '/egra', who)).toBe(true);

beforeEach(() => {
  process.env = { ...SAVED };
  process.env.CHILD_TEST_ENABLED = 'true';
  delete process.env.CHILD_TEST_OBSERVE_LINK;   // the default since 3 Oct: /egra is separate
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

describe('exactly one class teacher of the drawn class', () => {
  test('one button, "Send to <first name>", offered once per visit', async () => {
    await openList();
    expect(offers()).toHaveLength(1);
    const [btn] = offers()[0].buttons;
    expect(offers()[0].buttons).toHaveLength(1);
    expect(btn).toEqual({ id: 'ctst_tsend:teacher-1', title: 'Send to Sana' });
    expect(offers()[0].body).not.toMatch(/observed/i);
    await openList();
    expect(offers()).toHaveLength(1);
  });

  test('the tap sends that teacher ONE message, nobody else, and the coach is told who got it', async () => {
    await openList();
    const before = sent().length;
    expect(await H.handleButton(COACH, PHONE, 'ctst_tsend:teacher-1')).toBe(true);
    const out = sent().slice(before);
    const toTeacher = out.filter((m) => m.to === '923000000091');
    expect(toTeacher).toHaveLength(1);
    expect(toTeacher[0].kind).toBe('text');
    expect(out.every((m) => m.to === '923000000091' || m.to === PHONE)).toBe(true);
    expect(out.find((m) => m.to === PHONE).text).toBe('Sent the order to Sana Test Teacher.');
  });

  test('the flagged class teacher wins over another active teacher of the same class', async () => {
    seedDb({
      teachers: [teacher(1, 'Sana Test Teacher'), teacher(2, 'Bilal Subject Teacher')],
      links: [link(1, 'class-3a', { is_class_teacher: true }), link(2, 'class-3a', { is_class_teacher: false })],
    });
    await openList();
    expect(offers()[0].buttons.map((b) => b.id)).toEqual(['ctst_tsend:teacher-1']);
  });

  test('no flagged class teacher: the class\'s one active teacher is offered', async () => {
    seedDb({ links: [link(1, 'class-3a')] });
    await openList();
    expect(offers()[0].buttons.map((b) => b.id)).toEqual(['ctst_tsend:teacher-1']);
  });

  test('a leading "Muhammad" is skipped for the first name; the title stays inside 20 code points', async () => {
    seedDb({ teachers: [teacher(1, 'Muhammad Imran Test')] });
    await openList();
    expect(offers()[0].buttons[0].title).toBe('Send to Imran');
    jest.clearAllMocks(); mockWa.__sent.length = 0; mockRedis.__data.clear();
    seedDb({ teachers: [teacher(1, 'Abdulrehmanuddinkhan Test')] });
    lanes = createLaneFakes(); ports.__setForTest(lanes);
    await openList();
    expect([...offers()[0].buttons[0].title].length).toBeLessThanOrEqual(20);
  });

  test('Urdu coach: "<name> کو بھیجیں"', async () => {
    await openList({ ...COACH, preferred_language: 'ur' });
    const title = offers()[0].buttons[0].title;
    // the catalog isolates a Latin name inside an Urdu line (RLM + FSI … PDI); they count toward the cap
    expect(title.replace(/[\u200e\u200f\u2066-\u2069]/g, '')).toBe('Sana کو بھیجیں');
    expect([...title].length).toBeLessThanOrEqual(20);
  });
});

describe('several class teachers (the list spans sections)', () => {
  test('two: one button each, and the tap goes to the one tapped', async () => {
    seedDb({
      teachers: [teacher(1, 'Sana Test Teacher'), teacher(2, 'Bilal Test Teacher')],
      links: [link(1, 'class-3a', { is_class_teacher: true }), link(2, 'class-3b', { is_class_teacher: true })],
    });
    listSpansTwoClasses();
    await openList();
    expect(offers()).toHaveLength(1);
    expect(offers()[0].buttons.map((b) => b.id).sort()).toEqual(['ctst_tsend:teacher-1', 'ctst_tsend:teacher-2']);
    const before = sent().length;
    await H.handleButton(COACH, PHONE, 'ctst_tsend:teacher-2');
    const out = sent().slice(before);
    expect(out.filter((m) => m.to === '923000000092')).toHaveLength(1);
    expect(out.filter((m) => m.to === '923000000091')).toHaveLength(0);
  });

  test('two with the same first name: the buttons still tell them apart', async () => {
    seedDb({
      teachers: [teacher(1, 'Sana Akhtar'), teacher(2, 'Sana Bibi')],
      links: [link(1, 'class-3a', { is_class_teacher: true }), link(2, 'class-3b', { is_class_teacher: true })],
    });
    listSpansTwoClasses();
    await openList();
    const titles = offers()[0].buttons.map((b) => b.title);
    expect(new Set(titles).size).toBe(2);
    for (const t of titles) expect([...t].length).toBeLessThanOrEqual(20);
  });

  test('more than three: a list to pick from, and a row tap sends to that teacher', async () => {
    const ts = [1, 2, 3, 4].map((n) => teacher(n, `Teacher${n} Test`));
    seedDb({ teachers: ts, links: [1, 2, 3, 4].map((n) => link(n, n % 2 ? 'class-3a' : 'class-3b')) });
    listSpansTwoClasses();
    await openList();
    expect(offers()).toHaveLength(0);
    expect(pickLists()).toHaveLength(1);
    const rows = pickLists()[0].action.sections[0].rows;
    expect(rows).toHaveLength(4);
    for (const r of rows) expect([...r.title].length).toBeLessThanOrEqual(24);
    const before = sent().length;
    expect(await H.handleList(COACH, PHONE, 'ctst_tsend:teacher-3')).toBe(true);
    expect(sent().slice(before).filter((m) => m.to === '923000000093')).toHaveLength(1);
  });
});

describe('no class teacher', () => {
  test('none linked: no offer, the list still goes, no error', async () => {
    seedDb({ links: [] });
    await openList();
    expect(offers()).toHaveLength(0);
    expect(pickLists()).toHaveLength(0);
    expect(sent().some((m) => m.kind === 'list')).toBe(true);
    expect(logError).not.toHaveBeenCalled();
  });

  test('a class teacher with no WhatsApp number, or inactive, is not offered', async () => {
    seedDb({ teachers: [teacher(1, 'Sana Test Teacher', { phone_number: null })] });
    await openList();
    expect(offers()).toHaveLength(0);
    jest.clearAllMocks(); mockWa.__sent.length = 0; mockRedis.__data.clear();
    seedDb({ links: [link(1, 'class-3a', { is_class_teacher: true, is_active: false })] });
    lanes = createLaneFakes(); ports.__setForTest(lanes);
    await openList();
    expect(offers()).toHaveLength(0);
  });
});

describe('the button is a pointer, never a permission', () => {
  test('a teacher id that is not a class teacher of the list is refused, nothing sent to them', async () => {
    seedDb({ teachers: [teacher(1, 'Sana Test Teacher'), teacher(2, 'Other Class Teacher')],
      links: [link(1, 'class-3a', { is_class_teacher: true }), link(2, 'class-9z', { is_class_teacher: true })] });
    await openList();
    const before = sent().length;
    await H.handleButton(COACH, PHONE, 'ctst_tsend:teacher-2');
    expect(sent().slice(before).some((m) => m.to === '923000000092')).toBe(false);
  });

  test('deactivated between offer and tap: nothing sent to the teacher', async () => {
    await openList();
    mockDb.__tables.class_teachers[0].is_active = false;
    const before = sent().length;
    await H.handleButton(COACH, PHONE, 'ctst_tsend:teacher-1');
    expect(sent().slice(before).some((m) => m.to === '923000000091')).toBe(false);
  });
});

describe('L21 catalog keys fit their WhatsApp fields (code points)', () => {
  const { UX_STRINGS } = require('../../../bot/shared/config/ux-strings');
  const CAPS = { childTestSendToNamed: 20, childTestTeacherPickButton: 20, childTestTeacherPickSection: 24,
    childTestTeacherOfferOne: 1024, childTestTeacherOfferPick: 1024, childTestTeacherSentTo: 4096 };
  test.each(Object.entries(CAPS))('%s ≤ %i in en and ur', (k, cap) => {
    for (const lang of ['en', 'ur']) {
      expect(typeof UX_STRINGS[k][lang]).toBe('string');
      expect([...UX_STRINGS[k][lang]].length).toBeLessThanOrEqual(cap);
    }
  });
});
