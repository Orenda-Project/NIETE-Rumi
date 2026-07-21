/**
 * bd-2137 — level display labels must be vendor-aware.
 *
 * DB level names are already clean ("English", "Mathematics", "Professional
 * Training in Game-Based Teaching…"). The TRAINING_HOME / LEVEL_DETAIL
 * builders hardcode a ladder label `Level ${order_index+1} · ${name}` for
 * EVERY vendor, plus `🔒 Level ${slot}` ghost rows for unused slots. For
 * all_modules vendors (Beacon House, Oxbridge) the "levels" are subjects,
 * so teachers see confusing "Level 2 · English" rows and phantom
 * "Level 2..5 — Not part of this program" categories (reported twice on the
 * training feedback card, 20 Jul).
 *
 * Contract under test (pure helpers exported like partitionByVendor is):
 *   levelDisplayTitle(lvl)  → chain vendor:      "📚 Level 2 · Emerging Practitioner"
 *                             all_modules vendor: "📚 English"           (no ladder label)
 *   levelOptionTitle(lvl)   → chain:      "Level 2 · Emerging Practitioner — Continue"
 *                             all_modules: "English — Start"
 *   ghostSlotData(slot)     → { title: hidden-safe placeholder, progress: '',
 *                               visible: false } so the Flow can hide the row
 *                               (real levels get visible: true via
 *                               levelSlotVisible(lvl) === true).
 */

let levelDisplayTitle;
let levelOptionTitle;
let ghostSlotData;
let levelProgressLine;

beforeAll(() => {
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({
    trainingLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    logEvent: jest.fn(),
  }));
  jest.doMock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({}));
  jest.doMock('../../bot/shared/storage/r2', () => ({}));
  ({
    levelDisplayTitle,
    levelOptionTitle,
    ghostSlotData,
    levelProgressLine,
  } = require('../../bot/shared/routes/teacher-training-endpoint'));
});

const chainLevel = {
  name: 'Emerging Practitioner',
  order_index: 1,
  unlock_logic: 'chain',
  state: 'not_started',
  vendor_key: 'TALEEMABAD',
};

const subjectLevel = {
  name: 'English',
  order_index: 1,
  unlock_logic: 'all_modules',
  state: 'not_started',
  vendor_key: 'BEACONHOUSE',
};

const oxbridgeLevel = {
  name: 'Professional Training in Game-Based Teaching, Learning & Assessment',
  order_index: 4,
  unlock_logic: 'all_modules',
  state: 'not_started',
  vendor_key: 'OXBRIDGE',
};

describe('bd-2137 — vendor-aware level labels', () => {
  test('chain vendor keeps the ladder label', () => {
    expect(levelDisplayTitle(chainLevel)).toBe('📚 Level 1 · Emerging Practitioner'); // 0-based, app parity (bd-2235)
    expect(levelOptionTitle(chainLevel)).toBe('Level 1 · Emerging Practitioner — Start');
  });

  test('all_modules vendor renders the plain subject name — no "Level N ·" prefix', () => {
    expect(levelDisplayTitle(subjectLevel)).toBe('📚 English');
    expect(levelDisplayTitle(subjectLevel)).not.toMatch(/Level \d/);
    expect(levelOptionTitle(subjectLevel)).toBe('English — Start');
  });

  test('long Oxbridge name still shortened, still no ladder label', () => {
    expect(levelDisplayTitle(oxbridgeLevel)).toBe('📚 Game-Based Teaching (Oxbridge)');
    expect(levelOptionTitle(oxbridgeLevel)).toBe('Game-Based Teaching (Oxbridge) — Start');
  });

  test('missing unlock_logic defaults to the chain (legacy) label', () => {
    const legacy = { ...chainLevel, unlock_logic: undefined };
    expect(levelDisplayTitle(legacy)).toBe('📚 Level 1 · Emerging Practitioner');
  });

  test('locked chain level names its 0-based prerequisite (app parity, bd-2235)', () => {
    // order_index 2 = app "Level 2"; unlocks after app "Level 1"'s exam.
    const locked = { ...chainLevel, order_index: 2, state: 'locked' };
    expect(levelProgressLine(locked)).toBe('Unlocks after Level 1 exam');
  });

  test('ghost slots are marked hidden for the Flow', () => {
    const ghost = ghostSlotData(3);
    expect(ghost.visible).toBe(false);
    expect(ghost.progress).toBe('');
  });

  test('state emoji still tracks progress state for both vendor kinds', () => {
    expect(levelDisplayTitle({ ...subjectLevel, state: 'certified' })).toBe('🏆 English');
    expect(levelDisplayTitle({ ...chainLevel, state: 'locked' })).toBe('🔒 Level 1 · Emerging Practitioner');
  });
});
