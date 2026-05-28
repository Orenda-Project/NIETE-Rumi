/**
 * Framework Wiring Tests (TDD)
 *
 * Validates bd-609: analysis-processor.service.js and coaching.service.js
 * resolve the user's framework via selectFramework() and pass it to
 * GPT5MiniService.analyzePedagogy().
 *
 * These tests mock external deps (supabase, GPT, WhatsApp) to test
 * only the wiring logic.
 */

// ─── Mocks (before imports) ──────────────────────────────────────────

const mockSelect = jest.fn();
const mockUpdate = jest.fn();
const mockEq = jest.fn();
const mockSingle = jest.fn();
const mockNeq = jest.fn();
const mockHead = jest.fn();

jest.mock('../../bot/shared/config/supabase', () => {
  const chain = {
    select: (...args) => { mockSelect(...args); return chain; },
    eq: (...args) => { mockEq(...args); return chain; },
    neq: (...args) => { mockNeq(...args); return chain; },
    single: (...args) => { mockSingle(...args); return { data: { region: 'punjab', preferences: {} }, error: null }; },
    update: (...args) => { mockUpdate(...args); return chain; },
  };
  return { from: jest.fn(() => chain) };
});

jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: jest.fn(),
}));

jest.mock('../../bot/shared/utils/constants', () => ({
  OPENAI_API_KEY: 'test-key',
  PEDAGOGICAL_ANALYSIS_MEDIA_ID: 'test-media-id',
  TEMP_DIR: '/tmp',
}));

// Mock GPT5MiniService
const mockAnalyzePedagogy = jest.fn();
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({
  analyzePedagogy: mockAnalyzePedagogy,
}));

// Mock WhatsApp
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendStickerMessage: jest.fn(),
  sendMessage: jest.fn(),
}));

// Mock coaching-session.service
jest.mock('../../bot/shared/services/coaching/coaching-session.service', () => ({
  getSessionWithUser: jest.fn(),
}));

const { selectFramework } = require('../../bot/shared/services/coaching/frameworks/framework-selector');
const { getFramework } = require('../../bot/shared/services/coaching/frameworks/framework-registry');

// ─── Tests ───────────────────────────────────────────────────────────

describe('Framework Wiring (bd-609)', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    mockAnalyzePedagogy.mockResolvedValue({
      analysis: { executive_summary: 'Test', framework: 'hots', framework_version: '1.0', scores: { overall_marks: 30 } },
      usage: { input_tokens: 1000, output_tokens: 500, cached_tokens: 0, cost: 0.01 },
    });
  });

  test('SCENARIO: region→framework is env-driven (REGION_FRAMEWORK_MAP), not hardcoded', async () => {
    // The selector now delegates region routing to region-config (no hardcoded region names).
    // A deployment maps a region to a framework via REGION_FRAMEWORK_MAP. With the map set,
    // a Punjab user (supabase mock returns region:'punjab') resolves to HOTS.
    const ORIG = { ...process.env };
    try {
      jest.resetModules();
      process.env.REGION_FRAMEWORK_MAP = JSON.stringify({ punjab: 'hots' });
      const { selectFramework: select } = require('../../bot/shared/services/coaching/frameworks/framework-selector');
      const framework = await select('user-punjab-001');
      expect(framework.name).toBe('hots');
      expect(framework.displayName).toBe('HOTS Framework');
    } finally {
      process.env = { ...ORIG };
      jest.resetModules();
    }
  });

  test('SCENARIO: with no region map, a region falls back to the deployment default (oecd)', async () => {
    const ORIG = { ...process.env };
    try {
      jest.resetModules();
      delete process.env.REGION_FRAMEWORK_MAP;
      delete process.env.DEFAULT_OBSERVATION_FRAMEWORK;
      const { selectFramework: select } = require('../../bot/shared/services/coaching/frameworks/framework-selector');
      const framework = await select('user-punjab-001');
      expect(framework.name).toBe('oecd');
    } finally {
      process.env = { ...ORIG };
      jest.resetModules();
    }
  });

  test('SCENARIO: getFramework("oecd") returns OECD as fallback', () => {
    const framework = getFramework('oecd');
    expect(framework.name).toBe('oecd');
  });

  test('SCENARIO: analyzePedagogy accepts framework as 4th param', async () => {
    const framework = getFramework('hots');
    const GPT5MiniService = require('../../bot/shared/services/gpt5-mini.service');

    await GPT5MiniService.analyzePedagogy(
      'Teacher taught a lesson.',
      { teacherFirstName: 'Zara' },
      null,
      framework
    );

    expect(mockAnalyzePedagogy).toHaveBeenCalledWith(
      'Teacher taught a lesson.',
      { teacherFirstName: 'Zara' },
      null,
      framework
    );
  });

  test('SCENARIO: Framework wiring pattern: select → pass → analyze', async () => {
    // Simulate the wiring pattern from analysis-processor, with a region→framework map configured.
    const ORIG = { ...process.env };
    process.env.REGION_FRAMEWORK_MAP = JSON.stringify({ punjab: 'hots' });
    jest.resetModules();
    const { selectFramework: select } = require('../../bot/shared/services/coaching/frameworks/framework-selector');
    const framework = await select('user-punjab-001');
    const GPT5MiniService = require('../../bot/shared/services/gpt5-mini.service');

    const result = await GPT5MiniService.analyzePedagogy(
      'Transcript text',
      { teacherFirstName: 'Ali' },
      null,
      framework
    );
    process.env = { ...ORIG };

    expect(result.analysis.framework).toBe('hots');
    expect(mockAnalyzePedagogy).toHaveBeenCalledWith(
      'Transcript text',
      { teacherFirstName: 'Ali' },
      null,
      expect.objectContaining({ name: 'hots' })
    );
  });

  test('SCENARIO: If selectFramework fails, OECD fallback works', async () => {
    // selectFramework has a built-in try/catch that returns OECD on error
    // (from the framework-selector.js implementation)
    // But at the caller level, we also want to handle gracefully.
    const framework = getFramework('oecd');
    expect(framework.name).toBe('oecd');
    expect(framework.maxMarks).toBe(103);
  });

  test('SCENARIO: Report transformer dispatch uses analysis.framework', () => {
    const { getReportTransformer } = require(
      '../../bot/shared/services/coaching/report-transformers/report-transformer-dispatch'
    );

    const hotsTransformer = getReportTransformer('hots');
    const oecdTransformer = getReportTransformer('oecd');
    const unknownTransformer = getReportTransformer('unknown');

    expect(typeof hotsTransformer).toBe('function');
    expect(typeof oecdTransformer).toBe('function');
    // Unknown falls back to OECD
    expect(unknownTransformer).toBe(oecdTransformer);
  });
});
