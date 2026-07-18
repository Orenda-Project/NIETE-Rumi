/**
 * Framework Selection Reason Tests (FEAT-060, bd-2105)
 *
 * The selector's ambient behaviour (return-a-module) is preserved by
 * selectFramework(); a sibling selectFrameworkWithReason() adds the
 * provenance signal so callers can persist WHY a given framework was
 * chosen for an observation (user preference vs region default vs
 * deployment default vs fallback).
 *
 * The reason surface is the audit foothold for a canonical single-framework
 * deployment: every session records the exact selection path that fired.
 */

const mockSingle = jest.fn();
const mockEq = jest.fn(() => ({ single: mockSingle }));
const mockSelect = jest.fn(() => ({ eq: mockEq }));
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn(() => ({ select: mockSelect })),
}));

jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: jest.fn(),
}));

describe('selectFrameworkWithReason() (FEAT-060)', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  test('SCENARIO: user with explicit preference → reason = user_preference', async () => {
    const ORIG = { ...process.env };
    try {
      mockSingle.mockResolvedValueOnce({
        data: { region: 'punjab', preferences: { observation_framework: 'fico' } }
      });
      const { selectFrameworkWithReason } =
        require('../../bot/shared/services/coaching/frameworks/framework-selector');
      const result = await selectFrameworkWithReason('user-explicit');
      expect(result.framework.name).toBe('fico');
      expect(result.frameworkKey).toBe('fico');
      expect(result.reason).toBe('user_preference');
    } finally {
      process.env = { ...ORIG };
    }
  });

  test('SCENARIO: region maps to framework via REGION_FRAMEWORK_MAP → reason = region_default', async () => {
    const ORIG = { ...process.env };
    try {
      process.env.REGION_FRAMEWORK_MAP = JSON.stringify({ islamabad: 'fico' });
      mockSingle.mockResolvedValueOnce({
        data: { region: 'islamabad', preferences: {} }
      });
      const { selectFrameworkWithReason } =
        require('../../bot/shared/services/coaching/frameworks/framework-selector');
      const result = await selectFrameworkWithReason('user-region-mapped');
      expect(result.framework.name).toBe('fico');
      expect(result.frameworkKey).toBe('fico');
      expect(result.reason).toBe('region_default');
    } finally {
      process.env = { ...ORIG };
    }
  });

  test('SCENARIO: no map, no preference → reason = deployment_default', async () => {
    const ORIG = { ...process.env };
    try {
      delete process.env.REGION_FRAMEWORK_MAP;
      process.env.DEFAULT_OBSERVATION_FRAMEWORK = 'fico';
      mockSingle.mockResolvedValueOnce({
        data: { region: 'unknown-region', preferences: {} }
      });
      const { selectFrameworkWithReason } =
        require('../../bot/shared/services/coaching/frameworks/framework-selector');
      const result = await selectFrameworkWithReason('user-deployment-default');
      expect(result.framework.name).toBe('fico');
      expect(result.frameworkKey).toBe('fico');
      expect(result.reason).toBe('deployment_default');
    } finally {
      process.env = { ...ORIG };
    }
  });

  test('SCENARIO: NIETE-Rumi live config (DEFAULT_OBSERVATION_FRAMEWORK=fico) → FICO with deployment_default for any user', async () => {
    const ORIG = { ...process.env };
    try {
      delete process.env.REGION_FRAMEWORK_MAP;
      process.env.DEFAULT_OBSERVATION_FRAMEWORK = 'fico';
      mockSingle.mockResolvedValueOnce({
        data: { region: null, preferences: {} }
      });
      const { selectFrameworkWithReason } =
        require('../../bot/shared/services/coaching/frameworks/framework-selector');
      const result = await selectFrameworkWithReason('niete-teacher-1');
      expect(result.frameworkKey).toBe('fico');
      expect(result.reason).toBe('deployment_default');
    } finally {
      process.env = { ...ORIG };
    }
  });

  test('SCENARIO: non-existent user → reason = fallback_no_user', async () => {
    const ORIG = { ...process.env };
    try {
      process.env.DEFAULT_OBSERVATION_FRAMEWORK = 'fico';
      mockSingle.mockResolvedValueOnce({ data: null });
      const { selectFrameworkWithReason } =
        require('../../bot/shared/services/coaching/frameworks/framework-selector');
      const result = await selectFrameworkWithReason('missing-user');
      expect(result.frameworkKey).toBe('fico');
      expect(result.reason).toBe('fallback_no_user');
    } finally {
      process.env = { ...ORIG };
    }
  });

  test('SCENARIO: supabase throws → reason = fallback_error, framework = oecd', async () => {
    mockSingle.mockRejectedValueOnce(new Error('db down'));
    const { selectFrameworkWithReason } =
      require('../../bot/shared/services/coaching/frameworks/framework-selector');
    const result = await selectFrameworkWithReason('error-user');
    expect(result.framework.name).toBe('oecd');
    expect(result.frameworkKey).toBe('oecd');
    expect(result.reason).toBe('fallback_error');
  });

  test('SCENARIO: selectFramework() (legacy) still returns framework module directly', async () => {
    const ORIG = { ...process.env };
    try {
      process.env.DEFAULT_OBSERVATION_FRAMEWORK = 'fico';
      mockSingle.mockResolvedValueOnce({
        data: { region: null, preferences: {} }
      });
      const { selectFramework } =
        require('../../bot/shared/services/coaching/frameworks/framework-selector');
      const fw = await selectFramework('legacy-caller');
      expect(fw.name).toBe('fico');
      expect(typeof fw.getSystemPrompt).toBe('function');
    } finally {
      process.env = { ...ORIG };
    }
  });
});
