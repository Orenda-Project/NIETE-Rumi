/**
 * bd-6faz8m — portal paper editing has its own switch,
 * portal_assessment_editing_enabled. Row missing -> follow
 * assessment_editing_enabled; row present -> only true / "true" is on;
 * a failed read is off.
 */
const fs = require('fs');
const path = require('path');
const {
  isPortalAssessmentEditingEnabled, isAssessmentEditingEnabled,
  PORTAL_ASSESSMENT_EDITING_KEY, ASSESSMENT_EDITING_KEY,
} = require('../../dashboard/lib/feature-flags');

/** rows: {key: value}; opts.error / opts.throws apply to every read. */
function fakeSupabase(rows, opts = {}) {
  return {
    from: () => ({
      select: () => ({
        eq: (_c, key) => ({
          maybeSingle: async () => {
            if (opts.throws) throw new Error('boom');
            if (opts.error) return { data: null, error: { message: 'down' } };
            return { data: key in rows ? { value: rows[key] } : null, error: null };
          },
        }),
      }),
    }),
  };
}

describe('isPortalAssessmentEditingEnabled truth table', () => {
  test('keys', () => {
    expect(PORTAL_ASSESSMENT_EDITING_KEY).toBe('portal_assessment_editing_enabled');
    expect(ASSESSMENT_EDITING_KEY).toBe('assessment_editing_enabled');
  });

  test.each([
    ['row absent, old true -> on', { assessment_editing_enabled: true }, true],
    ['row absent, old "true" -> on', { assessment_editing_enabled: 'true' }, true],
    ['row absent, old false -> off', { assessment_editing_enabled: false }, false],
    ['row absent, old absent -> off', {}, false],
    ['true, old false -> on', { portal_assessment_editing_enabled: true, assessment_editing_enabled: false }, true],
    ['"true", old absent -> on', { portal_assessment_editing_enabled: 'true' }, true],
    ['false, old true -> off', { portal_assessment_editing_enabled: false, assessment_editing_enabled: true }, false],
    ['"false", old true -> off', { portal_assessment_editing_enabled: 'false', assessment_editing_enabled: true }, false],
    ['object {}, old true -> off', { portal_assessment_editing_enabled: {}, assessment_editing_enabled: true }, false],
    ['"yes", old true -> off', { portal_assessment_editing_enabled: 'yes', assessment_editing_enabled: true }, false],
    ['1, old true -> off', { portal_assessment_editing_enabled: 1, assessment_editing_enabled: true }, false],
  ])('%s', async (_n, rows, expected) => {
    expect(await isPortalAssessmentEditingEnabled(fakeSupabase(rows))).toBe(expected);
  });

  test('query error -> off, even when the old switch is on', async () => {
    expect(await isPortalAssessmentEditingEnabled(fakeSupabase({ assessment_editing_enabled: true }, { error: true }))).toBe(false);
  });

  test('thrown read -> off', async () => {
    expect(await isPortalAssessmentEditingEnabled(fakeSupabase({ assessment_editing_enabled: true }, { throws: true }))).toBe(false);
  });

  test('isAssessmentEditingEnabled is unchanged: reads only the old key', async () => {
    expect(await isAssessmentEditingEnabled(fakeSupabase({ portal_assessment_editing_enabled: true }))).toBe(false);
    expect(await isAssessmentEditingEnabled(fakeSupabase({ assessment_editing_enabled: true }))).toBe(true);
  });
});

describe('/config', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../dashboard/routes/portal.routes.js'), 'utf8');
  const block = src.slice(src.indexOf("router.get('/config'"), src.indexOf("router.get('/config'") + 3000);

  test('features.assessmentEditing comes from the portal switch', () => {
    expect(block).toMatch(/assessmentEditing = await isPortalAssessmentEditingEnabled\(supabase\)/);
    expect(block).not.toMatch(/await isAssessmentEditingEnabled\(/);
  });

  test('the catch branch stays closed', () => {
    expect(block).toMatch(/assessmentEditing: false/);
  });

  test('imported beside the other flags', () => {
    expect(src).toMatch(/isPortalAssessmentEditingEnabled,[\s\S]{0,400}\} = require\('\.\.\/lib\/feature-flags'\)/);
  });
});
