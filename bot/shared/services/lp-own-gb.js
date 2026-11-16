'use strict';
/**
 * bd-2zopnc — Make my own and the own-plan shelf stay off for GB teachers (Amena, 16 Nov 2026: "we dont want this
 * live for GB"). GB teachers get their lesson plans from the NIETE bot; the switches' "teachers" value would
 * otherwise let them in, as it reads users.role only.
 *
 * GB is the region rule's own answer (region.service regionForUser): users.source, users.region, then her school's
 * schools.region. 'ict' and 'unknown' are not GB. A failed read throws, and every caller turns the feature off.
 * Used by the bot (lp612-own-offer.js) and the portal (its Make my own and shelf doors, and its features list).
 */

const { regionForUser } = require('./region.service');

function must({ data, error }) {
  if (error) throw new Error(error.message || 'read failed');
  return data;
}

/** Is this user a GB teacher? Throws on a failed read. */
async function isGbTeacher(client, userId) {
  if (typeof userId !== 'string' || !userId) return false;
  const user = must(await client.from('users').select('id, source, region, school_id').eq('id', userId).maybeSingle());
  if (!user) return false;
  let schoolRegion = null;
  if (user.school_id) {
    const school = must(await client.from('schools').select('region').eq('id', user.school_id).maybeSingle());
    schoolRegion = school ? school.region : null;
  }
  return (await regionForUser(client, { ...user, school_region: schoolRegion })) === 'gb';
}

module.exports = { isGbTeacher };
