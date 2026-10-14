/**
 * v10 coaching test (bd-v0toag.21): the four groups, a 2x2 of plan x report.
 *
 * A = v9 + today's report, B = v10 card + today's report, C = v9 + new report,
 * D = v10 card + new report. The group belongs to the teacher's school and is read from
 * niete_coaching_ab_assignment, written once at the draw (ab-test-v10-coaching/workbench/draw.py).
 * Only while ab_v10_enabled is on. Anything that cannot be resolved (switch off, no school,
 * school not drawn, a read error) returns null: today's coaching. Never reads the ch3-8 LP
 * test's niete_lp_ab_assignment.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { v10Enabled } = require('./ab-v10-switch');

const TABLE = 'niete_coaching_ab_assignment';
const ARMS = {
  A: { plan: 'v9', report: 'today' },
  B: { plan: 'v10', report: 'today' },
  C: { plan: 'v9', report: 'new' },
  D: { plan: 'v10', report: 'new' },
};

/** { plan, report } for a group letter, else null. Pure. */
function armsOf(group) {
  return Object.prototype.hasOwnProperty.call(ARMS, group) ? { ...ARMS[group] } : null;
}

function resolved(group) {
  const a = armsOf(group);
  return a ? { group, ...a } : null;
}

/** { group, plan, report } for a teacher whose school is in the draw, else null. Never throws. */
async function groupFor(userId) {
  if (!userId) return null;
  try {
    if (!(await v10Enabled())) return null;
    const { data: user, error: uErr } = await supabase
      .from('users').select('id, school_id').eq('id', userId).maybeSingle();
    if (uErr) throw new Error(uErr.message);
    if (!user || !user.school_id) return null;
    const { data: row, error } = await supabase
      .from(TABLE).select('school_id, ab_group').eq('school_id', user.school_id).maybeSingle();
    if (error) throw new Error(error.message);
    return row ? resolved(row.ab_group) : null;
  } catch (err) {
    logToFile('v10 test: group lookup failed — today\'s coaching', { userId, error: err.message });
    return null;
  }
}

/**
 * groupFor for many teachers at once: userId → { group, plan, report } | null. Switch off:
 * every teacher null and nothing else is read. A failed read leaves everyone null.
 */
async function groupsForUsers(userIds, { chunk = 200 } = {}) {
  const out = new Map();
  const ids = [...new Set((userIds || []).filter(Boolean))];
  ids.forEach((id) => out.set(id, null));
  if (!ids.length || !(await v10Enabled())) return out;
  try {
    const schoolOf = new Map();
    for (let i = 0; i < ids.length; i += chunk) {
      // eslint-disable-next-line no-await-in-loop
      const { data, error } = await supabase
        .from('users').select('id, school_id').in('id', ids.slice(i, i + chunk));
      if (error) throw new Error(error.message);
      (data || []).forEach((u) => { if (u.school_id) schoolOf.set(u.id, u.school_id); });
    }
    const schools = [...new Set(schoolOf.values())];
    const groupOf = new Map();
    for (let i = 0; i < schools.length; i += chunk) {
      // eslint-disable-next-line no-await-in-loop
      const { data, error } = await supabase
        .from(TABLE).select('school_id, ab_group').in('school_id', schools.slice(i, i + chunk));
      if (error) throw new Error(error.message);
      (data || []).forEach((r) => groupOf.set(r.school_id, r.ab_group));
    }
    ids.forEach((id) => out.set(id, resolved(groupOf.get(schoolOf.get(id)))));
  } catch (err) {
    logToFile('v10 test: batch group lookup failed — today\'s coaching', { users: ids.length, error: err.message });
    ids.forEach((id) => out.set(id, null));
  }
  return out;
}

module.exports = { TABLE, armsOf, groupFor, groupsForUsers };
