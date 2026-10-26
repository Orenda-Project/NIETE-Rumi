'use strict';
/**
 * bd-gzfdu9 — the A/B arm, assigned when the recommendation is made. One seam (r-ab).
 * The salt is a constant in arm.js (r-ab 18:25Z, SPEC §1 v1.1): never env, never a table row.
 */
const crypto = require('crypto');
const A = require('../../../bot/shared/services/coaching/video-reco/arm');

const U = '60530046-7ac3-4ea3-a976-b43c37c23213';

test('the salt is the pre-registered constant', () => {
  expect(A.AB_SALT).toBe('vidrec-ab-2026-10-v1');
});

test('A/B off → every teacher is in the video arm', () => {
  expect(A.assignArm(U, {})).toBe('video');
  expect(A.assignArm(U, { VIDEO_RECO_AB_ENABLED: 'false' })).toBe('video');
});

test('A/B on → sha256(salt:user) first byte & 1 decides, deterministically', () => {
  const env = { VIDEO_RECO_AB_ENABLED: 'true' };
  const first = crypto.createHash('sha256').update(`vidrec-ab-2026-10-v1:${U}`).digest()[0];
  expect(A.assignArm(U, env)).toBe(first & 1 ? 'video' : 'control');
  expect(A.assignArm(U, env)).toBe(A.assignArm(U, env));
});

test('A/B on → both arms occur, roughly half each', () => {
  const env = { VIDEO_RECO_AB_ENABLED: '1' };
  let video = 0;
  for (let i = 0; i < 400; i++) if (A.assignArm(`user-${i}`, env) === 'video') video += 1;
  expect(video).toBeGreaterThan(160);
  expect(video).toBeLessThan(240);
});

test('an env salt is ignored (the constant is the only salt)', () => {
  const env = { VIDEO_RECO_AB_ENABLED: 'true' };
  const a = A.assignArm(U, env);
  expect(A.assignArm(U, { ...env, VIDEO_RECO_AB_SALT: 'other' })).toBe(a);
});

test('no user id → control (fail closed)', () => {
  expect(A.assignArm(null, { VIDEO_RECO_AB_ENABLED: 'true' })).toBe('control');
});
