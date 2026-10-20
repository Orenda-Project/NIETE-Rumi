'use strict';
/**
 * The A/B arm of a recommendation (bd-gzfdu9), assigned when it is made. Pure.
 *
 * With VIDEO_RECO_AB_ENABLED off every teacher is 'video' (no experiment; the sandbox e2e sees every clip).
 * On: sha256(`${AB_SALT}:${userId}`), first byte & 1 → 'video', else 'control'. Control rows are computed
 * and stored as 'shadow', never sent. The salt is a pre-registered constant (r-ab, ab/PREREG.md): never env,
 * never a row in niete_coaching_ab_assignment. A teacher-level hash is orthogonal to the v10 school draw.
 * One seam: r-ab may replace the hash behind this signature.
 */
const crypto = require('crypto');
const { videoRecoAbEnabled } = require('./flags');

const AB_SALT = 'vidrec-ab-2026-10-v1';

function assignArm(userId, env = process.env) {
  if (!videoRecoAbEnabled(env)) return 'video';
  if (!userId) return 'control';
  const first = crypto.createHash('sha256').update(`${AB_SALT}:${userId}`).digest()[0];
  return first & 1 ? 'video' : 'control';
}

module.exports = { assignArm, AB_SALT };
