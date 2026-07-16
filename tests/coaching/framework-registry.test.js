/**
 * Framework Registry + Selector Tests (TDD)
 *
 * Validates bd-596: Create framework-registry.js + framework-selector.js
 *
 * Registry: key → module (lazy require). Single source of truth.
 * Selector: reads user preferences → returns framework module.
 */

// Mock supabase for selector tests
const mockSingle = jest.fn();
const mockEq = jest.fn(() => ({ single: mockSingle }));
const mockSelect = jest.fn(() => ({ eq: mockEq }));
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn(() => ({ select: mockSelect })),
}));

jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: jest.fn(),
}));

const { getFramework, listFrameworks } = require('../../bot/shared/services/coaching/frameworks/framework-registry');
const { selectFramework } = require('../../bot/shared/services/coaching/frameworks/framework-selector');

describe('Framework Registry (bd-596)', () => {

  // ─── Registry ─────────────────────────────────────────────────────

  describe('getFramework()', () => {

    test('SCENARIO: getFramework("oecd") returns OECD module', () => {
      const fw = getFramework('oecd');
      expect(fw.name).toBe('oecd');
      expect(fw.displayName).toBe('OECD Framework');
      expect(typeof fw.getSystemPrompt).toBe('function');
    });

    test('SCENARIO: getFramework("hots") returns HOTS module', () => {
      const fw = getFramework('hots');
      expect(fw.name).toBe('hots');
      expect(fw.maxMarks).toBe(48);
    });

    test('SCENARIO: getFramework("teach") returns Teach module', () => {
      const fw = getFramework('teach');
      expect(fw.name).toBe('teach');
      expect(fw.maxMarks).toBe(50);
    });

    test('SCENARIO: getFramework("fico") returns FICO module', () => {
      const fw = getFramework('fico');
      expect(fw.name).toBe('fico');
      // ICT canonical rubric: 26 indicators × 4 = 104
      expect(fw.maxMarks).toBe(104);
    });

    test('SCENARIO: Unknown framework key throws error', () => {
      expect(() => getFramework('nonexistent')).toThrow('Unknown framework: nonexistent');
    });

    test('SCENARIO: Framework modules are lazily loaded (same instance on repeat)', () => {
      const fw1 = getFramework('oecd');
      const fw2 = getFramework('oecd');
      expect(fw1).toBe(fw2);
    });
  });

  describe('listFrameworks()', () => {

    test('SCENARIO: Lists all 5 registered framework keys', () => {
      const keys = listFrameworks();
      expect(keys).toContain('oecd');
      expect(keys).toContain('hots');
      expect(keys).toContain('teach');
      expect(keys).toContain('fico');
      expect(keys).toContain('mewaka');
      expect(keys).toHaveLength(5);
    });
  });
});

describe('Framework Selector (bd-596)', () => {

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Region→framework routing is env-driven (REGION_FRAMEWORK_MAP) — region-config owns it,
  // the selector holds no hardcoded region names. With a map configured, a region resolves
  // to its mapped framework; without one it falls back to the deployment default (oecd).
  test('SCENARIO: mapped region (punjab→hots) with no preference → HOTS framework', async () => {
    const ORIG = { ...process.env };
    try {
      mockSingle.mockResolvedValueOnce({ data: { region: 'punjab', district: null, preferences: {} } });
      process.env.REGION_FRAMEWORK_MAP = JSON.stringify({ punjab: 'hots', sindh: 'hots' });
      jest.resetModules();
      const { selectFramework: select } = require('../../bot/shared/services/coaching/frameworks/framework-selector');
      const fw = await select('user-punjab');
      expect(fw.name).toBe('hots');
      expect(mockSelect).toHaveBeenCalledWith('region, preferences');
    } finally {
      process.env = { ...ORIG };
      jest.resetModules();
    }
  });

  test('SCENARIO: mapped region (sindh→hots) with no preference → HOTS framework', async () => {
    const ORIG = { ...process.env };
    try {
      mockSingle.mockResolvedValueOnce({ data: { region: 'sindh', district: null, preferences: {} } });
      process.env.REGION_FRAMEWORK_MAP = JSON.stringify({ punjab: 'hots', sindh: 'hots' });
      jest.resetModules();
      const { selectFramework: select } = require('../../bot/shared/services/coaching/frameworks/framework-selector');
      const fw = await select('user-sindh');
      expect(fw.name).toBe('hots');
    } finally {
      process.env = { ...ORIG };
      jest.resetModules();
    }
  });

  test('SCENARIO: KPK user with no preference → OECD framework', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { region: 'kpk', district: null, preferences: {} }
    });

    const fw = await selectFramework('user-kpk');
    expect(fw.name).toBe('oecd');
  });

  test('SCENARIO: User with explicit teach preference → Teach framework', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { region: 'punjab', district: null, preferences: { observation_framework: 'teach' } }
    });

    const fw = await selectFramework('user-teach');
    expect(fw.name).toBe('teach');
  });

  test('SCENARIO: User with explicit fico preference → FICO framework', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { region: 'kpk', district: null, preferences: { observation_framework: 'fico' } }
    });

    const fw = await selectFramework('user-fico');
    expect(fw.name).toBe('fico');
  });

  test('SCENARIO: Non-existent user → OECD default', async () => {
    mockSingle.mockResolvedValueOnce({ data: null });

    const fw = await selectFramework('nonexistent');
    expect(fw.name).toBe('oecd');
  });
});
