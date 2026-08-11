/**
 * Tests for setup-validator — boot-time validator that checks
 * environment variables for flow configuration on startup.
 *
 * TDD: This test file was written BEFORE the implementation.
 */

const { validateBootRequirements } = require('../../bot/shared/utils/setup-validator');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Save and restore process.env around each test */
const FLOW_ENV_VARS = [
  'READING_ASSESSMENT_FLOW_ID',
  'SETTINGS_FLOW_ID',
  'STATUS_FLOW_ID',
  'FLOW_PRIVATE_KEY',
  'FLOW_PRIVATE_KEY_B64',
  'INTERNAL_API_KEY',
];

describe('validateBootRequirements', () => {
  let savedEnv;

  beforeEach(() => {
    // Snapshot the env vars we care about
    savedEnv = {};
    for (const key of FLOW_ENV_VARS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    // Suppress console output during tests
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore env vars
    for (const key of FLOW_ENV_VARS) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
    jest.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Return shape
  // -----------------------------------------------------------------------
  describe('return shape', () => {
    it('returns { ok, warnings, errors } structure', () => {
      const result = validateBootRequirements();

      expect(result).toHaveProperty('ok');
      expect(result).toHaveProperty('warnings');
      expect(result).toHaveProperty('errors');
      expect(typeof result.ok).toBe('boolean');
      expect(Array.isArray(result.warnings)).toBe(true);
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it('is a synchronous function (no Promise returned)', () => {
      const result = validateBootRequirements();

      // Should NOT be a Promise
      expect(result).not.toBeInstanceOf(Promise);
      expect(result.ok).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // All env vars set — happy path
  // -----------------------------------------------------------------------
  describe('all env vars set', () => {
    it('returns ok=true with no warnings and no errors', () => {
      process.env.READING_ASSESSMENT_FLOW_ID = 'flow_ra_1';
      process.env.SETTINGS_FLOW_ID = 'flow_settings_2';
      process.env.STATUS_FLOW_ID = 'flow_status_3';
      process.env.FLOW_PRIVATE_KEY = 'private_key_data';
      process.env.INTERNAL_API_KEY = 'test-api-key';

      const result = validateBootRequirements();

      expect(result.ok).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // READING_ASSESSMENT_FLOW_ID not set
  // -----------------------------------------------------------------------
  describe('READING_ASSESSMENT_FLOW_ID not set', () => {
    it('warns when READING_ASSESSMENT_FLOW_ID is not set', () => {
      // Leave READING_ASSESSMENT_FLOW_ID unset
      process.env.SETTINGS_FLOW_ID = 'flow_settings_2';
      process.env.STATUS_FLOW_ID = 'flow_status_3';
      process.env.FLOW_PRIVATE_KEY = 'private_key_data';

      const result = validateBootRequirements();

      expect(result.ok).toBe(true); // Warnings don't block
      expect(result.warnings).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/READING_ASSESSMENT_FLOW_ID/),
        ]),
      );
    });
  });

  // -----------------------------------------------------------------------
  // FLOW_PRIVATE_KEY missing when attendance flows are set
  // -----------------------------------------------------------------------
  describe('FLOW_PRIVATE_KEY missing with endpoint flows set', () => {
    it('errors when SETTINGS_FLOW_ID is set but FLOW_PRIVATE_KEY is missing', () => {
      process.env.READING_ASSESSMENT_FLOW_ID = 'flow_ra_1';
      process.env.SETTINGS_FLOW_ID = 'flow_settings_2';
      // FLOW_PRIVATE_KEY not set, STATUS_FLOW_ID not set

      const result = validateBootRequirements();

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/FLOW_PRIVATE_KEY/),
        ]),
      );
    });

    it('errors when STATUS_FLOW_ID is set but FLOW_PRIVATE_KEY is missing', () => {
      process.env.READING_ASSESSMENT_FLOW_ID = 'flow_ra_1';
      process.env.STATUS_FLOW_ID = 'flow_status_3';
      // FLOW_PRIVATE_KEY not set, SETTINGS_FLOW_ID not set

      const result = validateBootRequirements();

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/FLOW_PRIVATE_KEY/),
        ]),
      );
    });

    it('errors when both endpoint flow IDs are set but FLOW_PRIVATE_KEY is missing', () => {
      process.env.READING_ASSESSMENT_FLOW_ID = 'flow_ra_1';
      process.env.SETTINGS_FLOW_ID = 'flow_settings_2';
      process.env.STATUS_FLOW_ID = 'flow_status_3';
      // FLOW_PRIVATE_KEY not set

      const result = validateBootRequirements();

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/FLOW_PRIVATE_KEY/),
        ]),
      );
    });
  });

  // -----------------------------------------------------------------------
  // FLOW_PRIVATE_KEY missing without endpoint flows — no error
  // -----------------------------------------------------------------------
  describe('FLOW_PRIVATE_KEY missing without endpoint flows', () => {
    it('does not error when FLOW_PRIVATE_KEY is missing and no endpoint flows are set', () => {
      process.env.READING_ASSESSMENT_FLOW_ID = 'flow_ra_1';
      // No attendance flows set, no FLOW_PRIVATE_KEY set

      const result = validateBootRequirements();

      // Should not have errors — just warnings for missing attendance flows
      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Console output
  // -----------------------------------------------------------------------
  // FLOW_PRIVATE_KEY_B64 is what the deployments actually set; the encryption
  // service accepts either form. Before this, the validator only looked at the
  // raw-PEM var and logged a decryption error on every boot while Flows worked.
  describe('FLOW_PRIVATE_KEY_B64 satisfies the encryption requirement', () => {
    it('does not error when only the base64 form is set', () => {
      process.env.SETTINGS_FLOW_ID = 'flow_settings_2';
      process.env.FLOW_PRIVATE_KEY_B64 = Buffer.from('-----BEGIN PRIVATE KEY-----x').toString('base64');
      delete process.env.FLOW_PRIVATE_KEY;

      const { validateBootRequirements } = require('../../bot/shared/utils/setup-validator');
      const result = validateBootRequirements();

      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);
    });

    it('still errors when NEITHER form is set', () => {
      process.env.SETTINGS_FLOW_ID = 'flow_settings_2';
      delete process.env.FLOW_PRIVATE_KEY;
      delete process.env.FLOW_PRIVATE_KEY_B64;

      const { validateBootRequirements } = require('../../bot/shared/utils/setup-validator');
      const result = validateBootRequirements();

      expect(result.errors).toEqual([
        expect.stringMatching(/FLOW_PRIVATE_KEY/),
      ]);
    });
  });

  describe('console output', () => {
    it('logs warnings with [setup-validator] prefix', () => {
      // Leave all flow IDs unset

      validateBootRequirements();

      expect(console.warn).toHaveBeenCalled();
      const warnCalls = console.warn.mock.calls.map((call) => call[0]);
      expect(warnCalls.some((msg) => msg.includes('[setup-validator]'))).toBe(true);
    });

    it('logs errors with [setup-validator] prefix', () => {
      process.env.SETTINGS_FLOW_ID = 'flow_settings_2';
      // FLOW_PRIVATE_KEY not set

      validateBootRequirements();

      expect(console.error).toHaveBeenCalled();
      const errorCalls = console.error.mock.calls.map((call) => call[0]);
      expect(errorCalls.some((msg) => msg.includes('[setup-validator]'))).toBe(true);
    });

    it('logs setup command hint when there are errors', () => {
      process.env.SETTINGS_FLOW_ID = 'flow_settings_2';
      // FLOW_PRIVATE_KEY not set

      validateBootRequirements();

      const logCalls = console.error.mock.calls.map((call) => call[0]);
      expect(
        logCalls.some((msg) => msg.includes('run-full-setup.js')),
      ).toBe(true);
    });

    it('does not log setup command hint when there are only warnings', () => {
      // Leave READING_ASSESSMENT_FLOW_ID unset — warning only

      validateBootRequirements();

      const errorCalls = console.error.mock.calls.map((call) => call[0]);
      expect(
        errorCalls.some((msg) => msg.includes('run-full-setup.js')),
      ).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // All env vars missing
  // -----------------------------------------------------------------------
  describe('all env vars missing', () => {
    it('returns ok=true with warnings but no errors (no endpoint flows means no FLOW_PRIVATE_KEY error)', () => {
      // All env vars are already deleted in beforeEach

      const result = validateBootRequirements();

      expect(result.ok).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.errors).toHaveLength(0);
    });
  });
});
