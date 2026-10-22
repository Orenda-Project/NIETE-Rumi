/**
 * L25 (bd-s1oo0.46.1, operator 3 Oct 2026): no roll number reaches a coach or a teacher, anywhere.
 * Every child-test catalog line, the check Flow's child label and the "check did not open" line are
 * rendered for a child whose roster row HAS a roll (17), and must show neither the digits, "roll" nor
 * «رول». Only the Supabase client, WhatsApp and the logger are replaced; the store, check-store,
 * check-flow context, identity and recovery run for real. Names are invented.
 */
const { createFakeSupabase, CHILD_TEST_UNIQUE } = require('../L3/helpers/fake-supabase');

let mockFake;
const mockSent = [];
jest.mock('../../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(async (to, text) => { mockSent.push({ to, text }); return true; }) }));
jest.mock('../../../bot/shared/services/cache/railway-redis.service', () => ({}));

const { UX_STRINGS, resolveUx } = require('../../../bot/shared/config/ux-strings');
const CS = require('../../../bot/shared/services/child-test/check-flow/check-store');
const { loadSession, whoOf } = require('../../../bot/shared/services/child-test/check-flow/context');
const ports = require('../../../bot/shared/services/child-test/conversation/ports');
const R = require('../../../bot/shared/services/child-test/conversation/recovery');
const store = require('../../../bot/shared/services/child-test/store');

function expectNoRoll(text) {
  expect(text).not.toMatch(/\broll\b/i);
  expect(text).not.toMatch(/رول/);
  expect(text).not.toMatch(/17|۱۷/);
}

function seed() {
  mockFake = createFakeSupabase({
    users: [{ id: 'coach-1', phone_number: '923000000001', preferred_language: 'en' }],
    classes: [{ id: 'g3a', school_id: 'school-1', grade_code: 'grade_3', section: 'A', shift_code: 'morning', session_code: '2026-2027', is_active: true }],
    students: [{ id: 'st-1', student_name: 'Ayesha Khan', student_name_urdu: null, roll_number: 17, is_active: true }],
    child_test_draws: [{ id: 'draw-1', school_id: 'school-1', class_id: 'g3a', grade: 3, student_id: 'st-1', roll_number: 17, status: 'tested', form: 'A', history: [] }],
    child_test_sessions: [{ id: 'sess-1', draw_id: 'draw-1', coach_user_id: 'coach-1', school_id: 'school-1', class_id: 'g3a', grade: 3, student_id: 'st-1', form: 'A', channel: 'whatsapp', status: 'completed', timings: {} }],
    child_test_blocks: [],
  }, { unique: CHILD_TEST_UNIQUE });
}

beforeEach(() => { seed(); mockSent.length = 0; ports.__setForTest(null); });
afterAll(() => ports.__setForTest(null));

describe('the catalog: no child-test line carries a roll', () => {
  const keys = Object.keys(UX_STRINGS).filter((k) => k.startsWith('childTest'));
  test.each(keys)('%s', (key) => {
    for (const lang of ['en', 'ur']) {
      const tpl = UX_STRINGS[key][lang];
      expect(tpl).not.toMatch(/\{rolls?\}/);
      expect(tpl).not.toMatch(/\broll\b/i);
      expect(tpl).not.toMatch(/رول/);
      // Rendered with a child who has a roll: every param gets the child's label, never the roll.
      const params = {};
      for (const m of String(tpl).matchAll(/\{(\w+)\}/g)) params[m[1]] = m[1] === 'n' || m[1] === 'total' || m[1] === 'done' ? 2 : 'Ayesha Khan · 3-A';
      expectNoRoll(resolveUx(key, { language: lang, params }));
    }
  });
});

describe('the check Flow names the child by name and class (check-store + context)', () => {
  test('getChild carries name and class, not the roll; there is no roll reader any more', async () => {
    const child = await CS.getChild({ id: 'sess-1', draw_id: 'draw-1', student_id: 'st-1', class_id: 'g3a' });
    expect(child).not.toHaveProperty('rollNumber');
    expect(child).toMatchObject({ displayName: 'Ayesha Khan', classShort: '3-A', classLabel: 'Grade 3 - A', classLabelUr: 'جماعت سوم - A' });
    expect(CS.getRollNumber).toBeUndefined();
  });
  test('whoOf: "Ayesha Khan · 3-A" in English, Urdu digits in Urdu; the loaded context has no roll', async () => {
    const ctx = await loadSession('sess-1', 'coach-1');
    expect(ctx).not.toHaveProperty('roll');
    expect(whoOf(ctx, 'en')).toBe('Ayesha Khan · 3-A');
    expect(whoOf(ctx, 'ur')).toContain('۳-A');
    for (const lang of ['en', 'ur']) expectNoRoll(whoOf(ctx, lang));
  });
});

describe('the "check did not open" line (recovery.js)', () => {
  test('names the child by name and class, whatever roll the caller still passes', async () => {
    ports.__setForTest({ store, checkFlow: { sendCheck: async () => false } });
    await R.openCheck('sess-1', '923000000001', 'en', '17');
    expect(mockSent).toHaveLength(1);
    expect(mockSent[0].text).toBe('⚠️ The check for Ayesha Khan · 3-A is ready but did not open. Send /egra and tap the child to open it.');
    expectNoRoll(mockSent[0].text);
  });
  test('Urdu, and a child the roster no longer names: "this child", never a roll or a dash', async () => {
    ports.__setForTest({ store, checkFlow: { sendCheck: async () => ({ ok: false }) } });
    mockFake.__tables.students[0].student_name = null;
    await R.openCheck('sess-1', '923000000001', 'ur', undefined);
    expectNoRoll(mockSent[0].text);
    expect(mockSent[0].text).not.toMatch(/—|null|undefined/);
  });
});
