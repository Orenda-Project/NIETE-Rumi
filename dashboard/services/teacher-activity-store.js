'use strict';
/**
 * The portal's reader of the teacher activity store (docs/teacher-activity-store.md). The numbers behind Home's
 * "Last 30 days", My journey and the team view are counted twice a day by a job on the replica and kept in Redis;
 * this reads them back. REDIS ONLY: no database client is required here, and a miss never falls back to one.
 *
 *   readTeacherActivity(userId) -> the teacher's stored value, or null
 *   readTeamActivity()          -> the team summary, or null
 *
 * Fails soft: no Redis client, Redis down, no key, bad JSON, a value that fails the contract's check, or one older
 * than 36 h all answer null ("show no numbers"). Never throws. A warning names the key family, never a user.
 */
const EdgeRedis = require('../lib/edge-redis');
const {
  TEAM_ACTIVITY_KEY, teacherActivityKey, checkTeacherActivity, checkTeamActivity,
} = require('../../bot/shared/config/teacher-activity-contract');

async function readChecked(key, family, check) {
  const raw = await EdgeRedis.get(key);
  if (raw === null || raw === undefined) return null;
  let value;
  try {
    value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) {
    console.warn('teacher-activity: stored value is not JSON', { family });
    return null;
  }
  const checked = check(value, Date.now());
  if (!checked) console.warn('teacher-activity: stored value failed the contract or is stale', { family });
  return checked;
}

async function readTeacherActivity(userId) {
  const key = teacherActivityKey(userId);
  if (!key) return null;
  try { return await readChecked(key, 'teacher', checkTeacherActivity); } catch (_) { return null; }
}

async function readTeamActivity() {
  try { return await readChecked(TEAM_ACTIVITY_KEY, 'team', checkTeamActivity); } catch (_) { return null; }
}

module.exports = { readTeacherActivity, readTeamActivity };
