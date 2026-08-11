/**
 * bd-2542 — a device must never be offered an OTA bundle it cannot run.
 *
 * The reference implementation this ports from (the retired Django app) decides
 * the winning bundle CLIENT-side:
 *
 *     const result = data.reduce((a, b) => (a.version > b.version ? a : b));
 *
 * Three defects fall out of that one line, and this suite pins all three:
 *
 *   1. NO COMPATIBILITY CONTRACT. The bundle carries no minimum native version,
 *      so a JS bundle calling a Capacitor plugin that only exists in a newer
 *      binary is handed to an older one. It installs, then crashes on the code
 *      path nobody tested. The native and OTA release trains are joined by
 *      exactly one contract — min_native_version — and it has to be enforced
 *      where it cannot be skipped.
 *
 *   2. NO ROLLOUT CONTROL. `max(version)` means every device takes the newest
 *      bundle the moment it exists. There is no way to hold a bundle at 10% and
 *      watch it, which is the only mechanism that makes shipping to real
 *      teachers survivable.
 *
 *   3. THE COMPARISON IS UNTYPED. `a.version > b.version` on values straight
 *      off the wire compares strings when the API sends strings: "9" > "10" is
 *      true, so a device would pick bundle 9 over bundle 10.
 *
 * Deciding server-side is what fixes all three: an ineligible device never sees
 * the bundle at all, rather than seeing it and being trusted to decline.
 *
 * Pure unit test — the selector is exercised directly, no DB and no network, so
 * this runs in CI with no credentials.
 */
const {
  selectBundle,
  isInRollout,
} = require('../../bot/shared/services/ota-bundle-selector');

/** A bundle row as the table stores it. */
function bundle(overrides = {}) {
  return {
    bundle_version: 1,
    min_native_version: 1206,
    channel: 'production',
    environment: 'niete',
    rollout_percent: 100,
    bundle_url: 'https://example.invalid/b.zip',
    checksum_sha256: 'a'.repeat(64),
    ...overrides,
  };
}

describe('bd-2542 — OTA bundle eligibility', () => {
  describe('native-version compatibility', () => {
    it('does NOT offer a bundle that needs a newer binary than the device has', () => {
      const rows = [bundle({ bundle_version: 7, min_native_version: 1207 })];

      // Device is on 1206. The bundle needs 1207. This is the skew crash.
      expect(selectBundle(rows, { nativeVersion: 1206, deviceId: 'd1' })).toBeNull();
    });

    it('offers a bundle whose floor the device exactly meets', () => {
      const rows = [bundle({ bundle_version: 7, min_native_version: 1206 })];

      const picked = selectBundle(rows, { nativeVersion: 1206, deviceId: 'd1' });
      expect(picked).not.toBeNull();
      expect(picked.bundle_version).toBe(7);
    });

    it('falls back to the newest COMPATIBLE bundle, not the newest overall', () => {
      // The realistic shape after a native release: bundle 9 is built against
      // the new binary, bundle 8 still runs on the old one. A device that has
      // not taken the Play update yet must get 8 — not nothing, and not 9.
      const rows = [
        bundle({ bundle_version: 9, min_native_version: 1207 }),
        bundle({ bundle_version: 8, min_native_version: 1206 }),
      ];

      const picked = selectBundle(rows, { nativeVersion: 1206, deviceId: 'd1' });
      expect(picked.bundle_version).toBe(8);
    });
  });

  describe('version comparison is numeric, not lexicographic', () => {
    it('picks 10 over 9 even when the values arrive as strings', () => {
      // `"9" > "10"` is true in JS. The ported client compared raw wire values
      // exactly this way, so it would have taken the older bundle.
      const rows = [
        bundle({ bundle_version: '9' }),
        bundle({ bundle_version: '10' }),
      ];

      const picked = selectBundle(rows, { nativeVersion: 1206, deviceId: 'd1' });
      expect(Number(picked.bundle_version)).toBe(10);
    });
  });

  describe('channel isolation', () => {
    it('never serves an internal-channel bundle to a production request', () => {
      const rows = [
        bundle({ bundle_version: 12, channel: 'internal' }),
        bundle({ bundle_version: 4, channel: 'production' }),
      ];

      const picked = selectBundle(rows, {
        nativeVersion: 1206,
        deviceId: 'd1',
        channel: 'production',
      });
      expect(picked.bundle_version).toBe(4);
    });
  });

  describe('staged rollout', () => {
    it('offers nothing at 0% and something at 100%', () => {
      const held = [bundle({ bundle_version: 5, rollout_percent: 0 })];
      const live = [bundle({ bundle_version: 5, rollout_percent: 100 })];

      expect(selectBundle(held, { nativeVersion: 1206, deviceId: 'd1' })).toBeNull();
      expect(selectBundle(live, { nativeVersion: 1206, deviceId: 'd1' })).not.toBeNull();
    });

    it('is deterministic — a device does not flip in and out of the cohort', () => {
      // Re-bucketing per request would let a device take a bundle, drop out,
      // and take it again. The bucket must be a pure function of the inputs.
      const seen = new Set();
      for (let i = 0; i < 200; i++) {
        seen.add(isInRollout('device-abc', 5, 25));
      }
      expect(seen.size).toBe(1);
    });

    it('a device inside 10% is still inside every higher percentage', () => {
      // Ramping 10 -> 50 -> 100 must only ever ADD devices. If the bucketing
      // is not monotonic, a device that already installed the bundle could
      // fall out of the cohort on the way up.
      const inTen = [];
      for (let i = 0; i < 400; i++) {
        const id = `device-${i}`;
        if (isInRollout(id, 5, 10)) inTen.push(id);
      }
      expect(inTen.length).toBeGreaterThan(0);
      for (const id of inTen) {
        expect(isInRollout(id, 5, 50)).toBe(true);
        expect(isInRollout(id, 5, 100)).toBe(true);
      }
    });

    it('splits a population roughly at the requested percentage', () => {
      let hits = 0;
      const N = 2000;
      for (let i = 0; i < N; i++) {
        if (isInRollout(`device-${i}`, 5, 25)) hits++;
      }
      // Wide band — this asserts the bucketing is not degenerate (all-in or
      // all-out), not that the hash is perfectly uniform.
      expect(hits / N).toBeGreaterThan(0.15);
      expect(hits / N).toBeLessThan(0.35);
    });

    it('buckets independently per bundle, so one unlucky device is not always excluded', () => {
      // If the bucket ignored bundle_version, the same ~10% would be the
      // guinea pigs for every release forever.
      const a = isInRollout('device-abc', 5, 10);
      let differs = false;
      for (let v = 6; v < 40; v++) {
        if (isInRollout('device-abc', v, 10) !== a) { differs = true; break; }
      }
      expect(differs).toBe(true);
    });
  });

  describe('integrity', () => {
    it('refuses a bundle with no checksum — the client cannot verify it', () => {
      const rows = [bundle({ bundle_version: 5, checksum_sha256: null })];
      expect(selectBundle(rows, { nativeVersion: 1206, deviceId: 'd1' })).toBeNull();
    });
  });

  describe('degenerate input', () => {
    it('returns null rather than throwing on an empty or missing list', () => {
      expect(selectBundle([], { nativeVersion: 1206, deviceId: 'd1' })).toBeNull();
      expect(selectBundle(null, { nativeVersion: 1206, deviceId: 'd1' })).toBeNull();
    });

    it('offers nothing when the device native version is unknown', () => {
      // Guessing here is what ships a bundle to a binary that cannot run it.
      const rows = [bundle({ bundle_version: 5 })];
      expect(selectBundle(rows, { nativeVersion: null, deviceId: 'd1' })).toBeNull();
      expect(selectBundle(rows, { nativeVersion: 'abc', deviceId: 'd1' })).toBeNull();
    });
  });
});
