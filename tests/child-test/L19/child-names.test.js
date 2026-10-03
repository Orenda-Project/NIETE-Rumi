/**
 * L19 (bd-s1oo0.37, bd-s1oo0.36): every coach- and teacher-facing line that names a drawn child gives
 * the FULL name first and the roll only as a hint (CONTRACT §18), and a child with no roll never breaks
 * the conversation. NIETE roster, 3 Oct: 3.4% of Grade 3/5 children have no roll; one roll-less child
 * on the list made sendList throw `resolveUx: missing param "roll"`, the handler swallowed it, and the
 * coach got no list for the rest of the quarter.
 *
 * Mocked at the network boundary only (WhatsApp, Redis, R2, Supabase). Part 1 runs L3's real draw and
 * store on the in-memory Supabase; part 2 uses the L4 contract fakes so names and rolls can be shaped.
 * All names here are invented.
 */
const { createFakeRedis, createWhatsAppRecorder } = require('../L4/helpers/boundary');
const { createLaneFakes } = require('../L4/helpers/lane-fakes');

const mockRedis = createFakeRedis();
const mockWa = createWhatsAppRecorder();
let mockDb;
jest.mock('../../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../../bot/shared/services/whatsapp.service', () => mockWa);
jest.mock('../../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn(async (b, key) => `https://r2.example/${key}`) }));
jest.mock('../../../bot/shared/config/supabase', () => ({ from: (...a) => mockDb.from(...a) }));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../bot/shared/services/menu.service', () => ({ sendMenu: jest.fn(async () => true) }));

const { logError, logToFile } = require('../../../bot/shared/utils/logger');
const ports = require('../../../bot/shared/services/child-test/conversation/ports');
const H = require('../../../bot/shared/handlers/child-test.handler');
const { UX_STRINGS } = require('../../../bot/shared/config/ux-strings');

const COACH = { id: 'coach-1', role: 'coach', region: 'niete', preferred_language: 'en', phone_number: '923000000001' };
const COACH_UR = { ...COACH, preferred_language: 'ur' };
const PHONE = COACH.phone_number;
const SAVED = { ...process.env };
const cps = (s) => [...String(s || '')].length;
const sent = () => mockWa.__sent;
const last = (kind) => [...sent()].reverse().find((m) => !kind || m.kind === kind);
const texts = () => sent().map((m) => m.text || (m.body && (m.body.text || m.body)) || '').join('\n');
const voice = (id) => ({ id: `wamid.${id}`, timestamp: String(Math.floor(Date.now() / 1000) + 5), audio: { id, mime_type: 'audio/ogg' } });
const crashed = () => logError.mock.calls.filter((c) => /_crashed$/.test(c[0]));

function env() {
  process.env.CHILD_TEST_ENABLED = 'true';
  process.env.CHILD_TEST_OBSERVE_LINK = 'true';
  process.env.CHILD_TEST_DRAW_SECRET = 'test-secret';
  process.env.DEFAULT_REGION = 'niete-sandbox';
  process.env.RAILWAY_ENVIRONMENT = 'sandbox';
  mockRedis.__data.clear();
  mockWa.__sent.length = 0;
  Object.assign(mockWa.__ok, { text: true, buttons: true, list: true, image: true });
  jest.clearAllMocks();
}

afterEach(() => H.__drain());
afterAll(() => { process.env = SAVED; ports.__setForTest(null); });

/** Every row, header, body and button of a sent list fits Meta's caps and never says "null". */
function expectListSane(list) {
  expect(cps(list.header.text)).toBeLessThanOrEqual(60);
  expect(cps(list.body.text)).toBeLessThanOrEqual(1024);
  expect(cps(list.action.button)).toBeLessThanOrEqual(20);
  for (const s of list.action.sections) {
    expect(cps(s.title)).toBeLessThanOrEqual(24);
    for (const r of s.rows) {
      expect(cps(r.title)).toBeLessThanOrEqual(24);
      expect(cps(r.description)).toBeLessThanOrEqual(72);
      expect(`${r.title} ${r.description}`).not.toMatch(/null|undefined|\{/);
    }
  }
  expect(list.body.text).not.toMatch(/null|undefined|\{/);
}

// ---------------------------------------------------------------- part 1: L3's real draw and store

describe('a roll-less child on the real draw (bd-s1oo0.36)', () => {
  const T = () => mockDb.__tables;
  beforeEach(() => {
    const { createFakeSupabase, CHILD_TEST_UNIQUE } = require('../L3/helpers/fake-supabase');
    const { buildRoster } = require('../L3/helpers/roster');
    const seed = buildRoster({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 25 }] });
    // Every other register line has no serial, as in the 33 NIETE classes where that happens.
    for (const e of seed.class_enrollments) if (e.roll_number % 2 === 0) e.roll_number = null;
    for (const s of seed.students) if (s.roll_number % 2 === 0) s.roll_number = null;
    seed.users = [COACH, { id: 'teacher-1', role: 'teacher', school_id: 'school-1' }];
    seed.class_teachers = [{ teacher_user_id: 'teacher-1', class_id: 'g3a', is_active: true }];
    seed.observation_field_forms[0] = { ...seed.observation_field_forms[0], teacher_user_id: 'teacher-1', created_at: new Date().toISOString() };
    mockDb = createFakeSupabase(seed, { unique: CHILD_TEST_UNIQUE });
    env();
    const lanes = createLaneFakes();
    ports.__setForTest({ scoring: lanes.scoring, checkFlow: lanes.checkFlow, render: lanes.render });
  });

  test('/egra sends the list, names every child, and nothing says "null"', async () => {
    expect(await H.handleText(PHONE, '/egra', COACH)).toBe(true);
    expect(crashed()).toEqual([]);
    const drawn = T().child_test_draws.filter((d) => d.list_slot);
    expect(drawn.some((d) => d.roll_number == null)).toBe(true);   // the case under test is really on the list
    const list = last('list');
    expect(list).toBeTruthy();
    expectListSane(list);
    const rows = list.action.sections.flatMap((s) => s.rows);
    for (const r of rows) expect(r.title).toMatch(/^Child 3A-\d\d$/);   // the full name is the title
    // The teacher line names the children waiting, in order, name first.
    expect(list.body.text).toMatch(/Ask the class teacher for these children, one at a time, in this order: Child 3A-\d\d/);
  });

  test('a second /egra re-reads the same saved list and still sends it', async () => {
    await H.handleText(PHONE, '/egra', COACH);
    mockWa.__sent.length = 0;
    expect(await H.handleText(PHONE, '/egra', COACH)).toBe(true);
    expect(crashed()).toEqual([]);
    expect(last('list')).toBeTruthy();
  });

  test('a roll-less child goes through presence, three notes and stop without a crash', async () => {
    await H.handleText(PHONE, '/egra', COACH);
    const rows = last('list').action.sections[0].rows;
    const byDraw = new Map(T().child_test_draws.map((d) => [d.id, d]));
    const rollless = rows.map((r) => r.id.split(':')[1]).find((id) => byDraw.get(id).roll_number == null);
    expect(rollless).toBeTruthy();
    await H.handleList(COACH, PHONE, `ctst_child:${rollless}`);
    const pres = last('buttons');
    expect(pres.body).toMatch(/Child 3A-\d\d\nIs the child here/);
    expect(pres.body).not.toMatch(/null|Roll/);
    await H.handleButton(COACH, PHONE, `ctst_pres:${rollless}:p`);
    for (const b of ['u', 'e', 'm']) expect(await H.handleVoice(voice(`l19-${b}`), PHONE, COACH)).toBe(true);
    await H.__drain();
    expect(crashed()).toEqual([]);
    expect(texts()).not.toMatch(/null|undefined/);
  });
});

// ---------------------------------------------------------------- part 2: shaped names and rolls

const NAMES = {
  d1: { displayName: 'Ayesha Noor', displayNameUrdu: 'عائشہ نور', rollNumber: '8' },
  d2: { displayName: 'Bilal Ahmed', displayNameUrdu: null, rollNumber: null },
  d3: { displayName: 'Muhammad Abdul Rehman Khan Niazi', displayNameUrdu: 'محمد عبدالرحمٰن خان نیازی صاحبزادہ گل', rollNumber: '31' },
  d4: { displayName: 'Sana Iqbal', rollNumber: '12' },
  d5: { displayName: 'Hamza Tariq', rollNumber: '25' },
  d6: { displayName: 'Zainab Ali', rollNumber: null },
  d7: { displayName: 'Omar Farooq', rollNumber: '3' },
};
const shape = (overrides = {}) => (list) => {
  const apply = (c) => ({ ...c, ...NAMES[c.drawId], ...(overrides[c.drawId] || {}) });
  return { ...list, children: list.children.map(apply), alternates: list.alternates.map(apply) };
};

function seedFakeDb() {
  const { createFakeSupabase } = require('../../observe2/helpers/fake-supabase');
  mockDb = createFakeSupabase({
    users: [COACH, { id: 'teacher-1', role: 'teacher', phone_number: '923000000009', preferred_language: 'en' }],
    observation_field_forms: [{ id: 'form-1', observer_user_id: 'coach-1', teacher_user_id: 'teacher-1',
      visit_context: { school_ext_id: 'niete:111' }, created_at: new Date().toISOString() }],
    class_teachers: [{ teacher_user_id: 'teacher-1', class_id: 'class-3a', is_active: true }],
    classes: [{ id: 'class-3a', grade_code: 'grade_3', section: 'A', school_id: 'school-1', is_active: true }],
    leader_schools: [{ leader_user_id: 'coach-1', school_id: 'school-1', school_name: 'SIM — School', emis: '111' }],
  });
}

function setup(overrides, opts = {}) {
  env();
  seedFakeDb();
  const lanes = createLaneFakes({ shapeList: shape(overrides), ...opts });
  ports.__setForTest(lanes);
  return lanes;
}

describe('name first, roll as a hint (CONTRACT §18)', () => {
  test('list rows: the full name is the title, roll and status are the description', async () => {
    setup();
    await H.handleText(PHONE, '/egra', COACH);
    const list = last('list');
    expectListSane(list);
    const [main, alts] = list.action.sections;
    expect(main.rows[0]).toMatchObject({ title: 'Ayesha Noor', description: 'Roll 8 · New' });
    expect(main.rows[1]).toMatchObject({ title: 'Bilal Ahmed', description: 'New' });
    // 32 code points: clipped title, the full name leads the description.
    expect(main.rows[2].title).toBe('Muhammad Abdul Rehman K…');
    expect(main.rows[2].description).toBe('Muhammad Abdul Rehman Khan Niazi · Roll 31 · New');
    expect(main.rows[4].description).toBe('Roll 25 · Returning (Form B)');
    const ALT = UX_STRINGS.childTestAlternateRow.en;
    expect(alts.rows[0]).toMatchObject({ title: 'Zainab Ali', description: ALT });
    expect(alts.rows[1].title).toBe('Omar Farooq');
    expect(alts.rows[1].description.startsWith('Roll 3 · Alternate:')).toBe(true);
  });

  test('list rows in Urdu: the Urdu name when the roster has one, Urdu digits, within caps', async () => {
    setup();
    await H.handleText(PHONE, '/egra', COACH_UR);
    const list = last('list');
    expectListSane(list);
    const main = list.action.sections[0].rows;
    expect(main[0].title).toBe('عائشہ نور');
    expect(main[0].description).toMatch(/^رول ۸ · /);
    expect(main[1].title).toBe('Bilal Ahmed');
    expect(main[2].description.startsWith('محمد عبدالرحمٰن خان نیازی صاحبزادہ گل · رول ۳۱')).toBe(true);
  });

  test('the teacher line in the list body names the children in order, roll as a hint', async () => {
    setup();
    await H.handleText(PHONE, '/egra', COACH);
    expect(last('list').body.text).toContain('Ask the class teacher for these children, one at a time, in this order: '
      + 'Ayesha Noor · roll 8, Bilal Ahmed, Muhammad Abdul Rehman Khan Niazi · roll 31, Sana Iqbal · roll 12, Hamza Tariq · roll 25');
    await H.handleText(PHONE, '/egra', COACH_UR);
    expect(last('list').body.text).toContain('کلاس ٹیچر سے یہ بچے ایک ایک کر کے اسی ترتیب سے بلوائیں: عائشہ نور · رول ۸، Bilal Ahmed،');
  });

  test('the presence prompt leads with the name; a roll-less child has no roll at all', async () => {
    setup();
    await H.handleText(PHONE, '/egra', COACH);
    await H.handleList(COACH, PHONE, 'ctst_child:d1');
    expect(last('buttons').body).toBe('*Child 1 of 5*\nAyesha Noor · roll 8\nIs the child here and willing to read?');
    await H.handleText(PHONE, '/egra', COACH);
    await H.handleList(COACH, PHONE, 'ctst_child:d2');
    expect(last('buttons').body).toBe('*Child 2 of 5*\nBilal Ahmed\nIs the child here and willing to read?');
  });

  test('absent: the absent child and the alternate who steps in are both named', async () => {
    setup();
    await H.handleText(PHONE, '/egra', COACH);
    await H.handleList(COACH, PHONE, 'ctst_child:d2');
    await H.handleButton(COACH, PHONE, 'ctst_pres:d2:a');
    expect(last('text').text).toBe('Bilal Ahmed marked absent.\nZainab Ali from the alternates joins today\'s list.');
    expect(crashed()).toEqual([]);
  });

  test('refused, in Urdu', async () => {
    setup();
    await H.handleText(PHONE, '/egra', COACH_UR);
    await H.handleList(COACH_UR, PHONE, 'ctst_child:d1');
    await H.handleButton(COACH_UR, PHONE, 'ctst_pres:d1:r');
    expect(last('text').text.split('\n')[0]).toBe('عائشہ نور · رول ۸ انکار درج۔');
  });

  test('busy: tapping another child mid-test names the child still in progress', async () => {
    setup();
    await H.handleText(PHONE, '/egra', COACH);
    await H.handleList(COACH, PHONE, 'ctst_child:d2');
    await H.handleButton(COACH, PHONE, 'ctst_pres:d2:p');
    await H.handleList(COACH, PHONE, 'ctst_child:d1');
    expect(last('text').text).toMatch(/^Bilal Ahmed is still in progress \(Urdu\)\./);
  });

  test('the block prompt names the child under test', async () => {
    setup();
    await H.handleText(PHONE, '/egra', COACH);
    await H.handleList(COACH, PHONE, 'ctst_child:d2');
    await H.handleButton(COACH, PHONE, 'ctst_pres:d2:p');
    expect(last('buttons').body).toMatch(/^\*Child 2 of 5 · Bilal Ahmed · Urdu 1\/3\*/);
  });

  test('stopping a child names the child', async () => {
    setup();
    await H.handleText(PHONE, '/egra', COACH);
    await H.handleList(COACH, PHONE, 'ctst_child:d1');
    await H.handleButton(COACH, PHONE, 'ctst_pres:d1:p');
    await H.handleButton(COACH, PHONE, 'ctst_stop');
    expect(texts()).toContain('Stopped the test for Ayesha Noor · roll 8. The child stays on today\'s list.');
  });

  test('three notes for a roll-less child: every ack and line is free of "null"', async () => {
    setup();
    await H.handleText(PHONE, '/egra', COACH);
    await H.handleList(COACH, PHONE, 'ctst_child:d2');
    await H.handleButton(COACH, PHONE, 'ctst_pres:d2:p');
    for (const b of ['u', 'e', 'm']) await H.handleVoice(voice(`v-${b}`), PHONE, COACH);
    await H.__drain();
    expect(crashed()).toEqual([]);
    // Lines still keyed on a roll (the strip lines, L20's) print a dash for a roll-less child, never throw.
    expect(logError.mock.calls.filter((c) => /failed|crashed/.test(c[0]))).toEqual([]);
    expect(sent().some((m) => m.kind === 'buttons' && (m.buttons || []).some((x) => x.id === 'ctst_nophoto:sess-1'))).toBe(true);
    expect(texts()).not.toMatch(/null/);
  });

  test('"Send to teacher": the teacher gets names in order with the roll as a hint', async () => {
    setup();
    await H.handleText(PHONE, '/egra', COACH);
    await H.handleButton(COACH, PHONE, 'ctst_tsend');
    const msg = sent().find((m) => m.to === '923000000009');
    expect(msg.text).toBe('For today\'s child test, please send these children to the coach one at a time, in this order: '
      + 'Ayesha Noor · roll 8, Bilal Ahmed, Muhammad Abdul Rehman Khan Niazi · roll 31, Sana Iqbal · roll 12, Hamza Tariq · roll 25. '
      + 'When one comes back, send the next.');
  });

  test('names never reach the logs', async () => {
    setup();
    await H.handleText(PHONE, '/egra', COACH);
    await H.handleList(COACH, PHONE, 'ctst_child:d2');
    await H.handleButton(COACH, PHONE, 'ctst_pres:d2:a');
    await H.handleButton(COACH, PHONE, 'ctst_tsend');
    const logged = JSON.stringify([...logToFile.mock.calls, ...logError.mock.calls]);
    for (const n of Object.values(NAMES)) expect(logged).not.toContain(n.displayName);
  });
});

describe('two children with the same name', () => {
  test('rolls separate them; with no roll the father\'s name is added', async () => {
    setup({
      d1: { displayName: 'Ali Raza', rollNumber: '4', fatherName: 'Raza Khan' },
      d2: { displayName: 'Ali Raza', rollNumber: null, fatherName: 'Imran Shah' },
      d3: { displayName: 'Ali Raza', rollNumber: null, fatherName: null },
      d6: { displayName: 'Ali Raza', rollNumber: null, fatherName: 'Tahir Mehmood' },
    });
    await H.handleText(PHONE, '/egra', COACH);
    const list = last('list');
    expectListSane(list);
    const [main, alts] = list.action.sections;
    expect(main.rows[0].description).toBe('Roll 4 · New');
    expect(main.rows[1].description).toBe('father: Imran Shah · New');
    expect(main.rows[2].description).toBe('New');                      // no roll, no father: graceful
    expect(alts.rows[0].description.startsWith('father: Tahir Mehmood · Alternate:')).toBe(true);
    expect(main.rows[3].description).toBe('Roll 12 · New');            // a unique name gets no father
  });

  test('in Urdu the father hint is Urdu', async () => {
    setup({
      d1: { displayName: 'Ali Raza', displayNameUrdu: null, rollNumber: null, fatherName: 'Raza Khan', fatherNameUrdu: 'رضا خان' },
      d2: { displayName: 'Ali Raza', rollNumber: null, fatherName: 'Imran Shah' },
    });
    await H.handleText(PHONE, '/egra', COACH_UR);
    const main = last('list').action.sections[0].rows;
    expect(main[0].description).toMatch(/^والد: رضا خان · /);
    expect(main[1].description).toMatch(/^والد: Imran Shah · /);
  });
});

describe('edge names and caps', () => {
  const LONG_UR = 'محمد عبدالرحمٰن خان نیازی صاحبزادہ گل محمد عبدالرحمٰن خان نیازی صاحبزادہ گل';
  test('a nameless roll-less child, a very long Urdu name with a father: no throw, within caps', async () => {
    setup({
      d1: { displayName: null, displayNameUrdu: null, rollNumber: null },
      d2: { displayName: null, displayNameUrdu: null, rollNumber: '7' },
      d3: { displayName: 'Muhammad Abdul Rehman Khan Niazi Sahibzada Gul', displayNameUrdu: LONG_UR, rollNumber: '123', fatherName: 'X' },
      d4: { displayName: 'Muhammad Abdul Rehman Khan Niazi Sahibzada Gul', displayNameUrdu: LONG_UR, rollNumber: null, fatherName: 'Long Father Name Here Too', fatherNameUrdu: LONG_UR },
    });
    for (const coach of [COACH, COACH_UR]) {
      mockWa.__sent.length = 0;
      expect(await H.handleText(PHONE, '/egra', coach)).toBe(true);
      expect(crashed()).toEqual([]);
      const list = last('list');
      expectListSane(list);
      await H.handleList(coach, PHONE, 'ctst_child:d1');
      const b = last('buttons');
      expect(cps(b.body)).toBeLessThanOrEqual(1024);
      expect(b.body).not.toMatch(/null|undefined/);
    }
    const en = sent();
    expect(en.length).toBeGreaterThan(0);
  });

  test('the presence prompt for a nameless child uses the roll, then the no-name label', async () => {
    setup({ d1: { displayName: null, displayNameUrdu: null, rollNumber: null }, d2: { displayName: null, rollNumber: '7' } });
    await H.handleText(PHONE, '/egra', COACH);
    await H.handleList(COACH, PHONE, 'ctst_child:d1');
    expect(last('buttons').body).toContain('(no name on the class list)\nIs the child here');
    await H.handleText(PHONE, '/egra', COACH);
    await H.handleList(COACH, PHONE, 'ctst_child:d2');
    expect(last('buttons').body).toContain('Roll 7\nIs the child here');
  });
});

describe('catalog', () => {
  test('the roll-first keys are retired', () => {
    expect(UX_STRINGS.childTestRowTitle).toBeUndefined();
    expect(UX_STRINGS.childTestRollItemNamed).toBeUndefined();
  });
  test('no L19-owned line asks for a roll any more', () => {
    for (const k of ['childTestPresenceBody', 'childTestBusy', 'childTestOutcomeAbsent', 'childTestOutcomeRefused',
      'childTestPromoted', 'childTestAlreadyDone', 'childTestVoiceAllIn', 'childTestCancelledChild', 'childTestListTeacherLine',
      'childTestTeacherMessage', 'childTestTeacherSendFailed']) {
      for (const lang of ['en', 'ur']) expect([k, lang, /\{roll\}|\{rolls\}|roll numbers|رول نمبر/.test(UX_STRINGS[k][lang])]).toEqual([k, lang, false]);
    }
  });
});
