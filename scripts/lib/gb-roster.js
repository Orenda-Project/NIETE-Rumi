'use strict';
/**
 * bd-rj6w0n.14.2 — pure decisions for seeding GB teachers' region (and school) from the GB roster.
 *
 * The roster is gitignored personal data; scripts/seed-gb-roster.js reads it at run time and hands the
 * rows here, with the GB region as the region registry spells it (region_features.display_name, read by the
 * script: no region name lives here). A roster phone that is a user gets that region only while users.region
 * is empty, and the roster school only when users.school_id is empty and the EMIS names exactly one
 * school. Nothing is ever overwritten. Counts name no one.
 */

const PHONE_KEY = 'Teacher WhatsApp*';
const EMIS_KEY = 'School ID/EMIS*';

/** Any Pakistani mobile spelling -> '92' + ten digits (users.phone_number's form), else null. */
function normalisePkPhone(raw) {
  if (raw === null || raw === undefined) return null;
  let d = String(raw).replace(/[^\d]/g, '');
  if (d.startsWith('0092')) d = d.slice(4);
  else if (d.startsWith('92') && d.length === 12) d = d.slice(2);
  else if (d.startsWith('0') && d.length === 11) d = d.slice(1);
  return /^3\d{9}$/.test(d) ? `92${d}` : null;
}

/** '12345.0' / 12345 -> '12345'; blank or 'nan' -> null. */
function normaliseEmis(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().replace(/\.0+$/, '');
  return /^\d+$/.test(s) ? s : null;
}

const keyOf = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

/**
 * roster: rows with PHONE_KEY / EMIS_KEY; users: { id, phone_number, region, school_id }; schools: the GB
 * schools { id, emis }; gbRegions: the registry's GB regions (exactly one). -> { writes: [{ userId, patch }], counts }.
 */
function planRosterWrites({ roster, users, schools, gbRegions }) {
  if (!Array.isArray(gbRegions) || gbRegions.length !== 1) throw new Error('the registry must hold exactly one GB region');
  const [gbRegion] = gbRegions;
  const counts = {
    rosterRows: roster.length, rosterNumbers: 0, unparseable: 0, matchedUsers: 0, notYetUsers: 0,
    regionSet: 0, schoolSet: 0, alreadyKnown: 0, schoolUnresolved: 0,
  };
  const emisOfPhone = new Map();
  for (const row of roster) {
    const phone = normalisePkPhone(row[PHONE_KEY]);
    if (!phone) { counts.unparseable += 1; continue; }
    if (!emisOfPhone.has(phone)) emisOfPhone.set(phone, normaliseEmis(row[EMIS_KEY]));
  }
  counts.rosterNumbers = emisOfPhone.size;

  const schoolsByEmis = new Map();
  for (const s of schools) {
    const e = normaliseEmis(s.emis);
    if (e) schoolsByEmis.set(e, [...(schoolsByEmis.get(e) || []), s.id]);
  }

  const writes = [];
  const seen = new Set();
  for (const u of users) {
    const phone = normalisePkPhone(u.phone_number);
    if (!phone || !emisOfPhone.has(phone)) continue;
    seen.add(phone);
    counts.matchedUsers += 1;
    // Any value already in users.region is hers: a GB one still gets a missing school, anything else is left alone.
    if (u.region != null) { counts.alreadyKnown += 1; if (keyOf(u.region) !== keyOf(gbRegion)) continue; }
    const patch = {};
    if (u.region == null) patch.region = gbRegion;
    if (!u.school_id) {
      const ids = schoolsByEmis.get(emisOfPhone.get(phone)) || [];
      if (ids.length === 1) patch.school_id = ids[0];
      else counts.schoolUnresolved += 1;
    }
    if (patch.region) counts.regionSet += 1;
    if (patch.school_id) counts.schoolSet += 1;
    if (Object.keys(patch).length) writes.push({ userId: u.id, patch });
  }
  counts.notYetUsers = counts.rosterNumbers - seen.size;
  return { writes, counts };
}

module.exports = { normalisePkPhone, normaliseEmis, planRosterWrites, PHONE_KEY, EMIS_KEY };
