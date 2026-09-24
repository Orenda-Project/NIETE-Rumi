/**
 * TODO(NIETE-ISAPS-GO-LIVE): when I-SAPS training goes live for ALL teachers,
 * remove the watermark from I-SAPS certificates — empty PILOT_WATERMARK_VENDORS
 * in bot/shared/services/training/certificate-env.rules.js and flip the
 * production assertions below. Grep the tag: rg "NIETE-ISAPS-GO-LIVE"
 *
 * Operator, 2026-09-23: "make that watermark default for all ... when we are
 * making this live for all the teachers, we want to remove this from the
 * certificate as well." Scoped by the operator the same day to I-SAPS ONLY:
 * production issues real Oxbridge / Beacon House / NIETE certificates every
 * day (1,000+ since 1 Aug), and those must stay clean there.
 */
const {
  shouldStampTestBanner,
  PILOT_WATERMARK_VENDORS,
} = require('../../bot/shared/services/training/certificate-env.rules');

describe('I-SAPS pilot watermark', () => {
  test('an I-SAPS certificate is stamped in PRODUCTION too, while the pilot runs', () => {
    expect(shouldStampTestBanner('production', 'ISAPS')).toBe(true);
  });

  test('...and in every other environment', () => {
    for (const env of ['sandbox', 'staging', undefined]) {
      expect(shouldStampTestBanner(env, 'ISAPS')).toBe(true);
    }
  });

  test('every OTHER vendor is still clean in production', () => {
    for (const v of ['TALEEMABAD', 'BEACONHOUSE', 'OXBRIDGE', undefined]) {
      expect(shouldStampTestBanner('production', v)).toBe(false);
    }
  });

  test('the pilot list is exactly I-SAPS — widening it is a deliberate change', () => {
    expect([...PILOT_WATERMARK_VENDORS]).toEqual(['ISAPS']);
  });
});
