/**
 * I-SAPS pilot watermark — INVERTED at go-live (bd-vej4h, 2026-10-01).
 *
 * From 2026-09-23 I-SAPS certificates carried "NOT A REAL CERTIFICATE" in every
 * environment, production included, while the training was a pilot. On
 * 2026-10-01 I-SAPS went live for every Middle & High teacher and the operator
 * asked for certificates "without the 'Not a real cert' thingy". These tests
 * used to pin the stamp; they now pin its absence, so a pilot list that quietly
 * re-gains a live vendor fails here.
 */
const {
  shouldStampTestBanner,
  PILOT_WATERMARK_VENDORS,
} = require('../../bot/shared/services/training/certificate-env.rules');

describe('I-SAPS after go-live', () => {
  test('an I-SAPS certificate in PRODUCTION is clean', () => {
    expect(shouldStampTestBanner('production', 'ISAPS')).toBe(false);
  });

  test('outside production it is stamped like every other vendor', () => {
    for (const env of ['sandbox', 'staging', undefined]) {
      expect(shouldStampTestBanner(env, 'ISAPS')).toBe(true);
    }
  });

  test('every other vendor is still clean in production', () => {
    for (const v of ['TALEEMABAD', 'BEACONHOUSE', 'OXBRIDGE', undefined]) {
      expect(shouldStampTestBanner('production', v)).toBe(false);
    }
  });

  test('no vendor is a pilot right now — adding one is a deliberate change', () => {
    expect([...PILOT_WATERMARK_VENDORS]).toEqual([]);
  });
});
