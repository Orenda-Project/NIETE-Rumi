'use strict';
/**
 * bd-gzfdu9 — the video recommendation's switches. Read at call time; unset = off.
 */
const F = require('../../../bot/shared/services/coaching/video-reco/flags');

test.each([
  [{}, false],
  [{ VIDEO_RECO_ENABLED: '' }, false],
  [{ VIDEO_RECO_ENABLED: 'false' }, false],
  [{ VIDEO_RECO_ENABLED: 'off' }, false],
  [{ VIDEO_RECO_ENABLED: 'true' }, true],
  [{ VIDEO_RECO_ENABLED: ' TRUE ' }, true],
  [{ VIDEO_RECO_ENABLED: '1' }, true],
])('videoRecoEnabled(%p) → %p', (env, want) => {
  expect(F.videoRecoEnabled(env)).toBe(want);
});

test.each([
  [{}, false],
  [{ VIDEO_RECO_AB_ENABLED: 'true' }, true],
  [{ VIDEO_RECO_AB_ENABLED: '1' }, true],
  [{ VIDEO_RECO_AB_ENABLED: '0' }, false],
])('videoRecoAbEnabled(%p) → %p', (env, want) => {
  expect(F.videoRecoAbEnabled(env)).toBe(want);
});

test('reads process.env at call time, not at import', () => {
  const before = process.env.VIDEO_RECO_ENABLED;
  delete process.env.VIDEO_RECO_ENABLED;
  expect(F.videoRecoEnabled()).toBe(false);
  process.env.VIDEO_RECO_ENABLED = 'true';
  expect(F.videoRecoEnabled()).toBe(true);
  if (before === undefined) delete process.env.VIDEO_RECO_ENABLED; else process.env.VIDEO_RECO_ENABLED = before;
});
