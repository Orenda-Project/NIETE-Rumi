'use strict';
/**
 * bd-r2uzg1.18.1 — a training provider that is for one grade band only.
 *
 * WHY THIS EXISTS
 * Band selection gives MIDDLE and HIGH one programme, niete_middle_high (band-selection.service.js,
 * bandsToPrograms), and that programme's scope lists the I-SAPS vendor ("Teacher Development Programme, 9-12")
 * with no level filter. So a teacher who teaches Middle only (Grades 6-8) was shown, and could start, the
 * Grades 9-12 course: in the WhatsApp training Flow, on the portal's training pages, and at the exam gate.
 * ICT logged it P0 (ICT sheet, Middle and High TT rows 75 and 78).
 *
 * THE RULE (product: I-SAPS is for Grades 9-12)
 *   A scope row that brings a band-only vendor in THROUGH A BAND PROGRAMME counts only when
 *     - her teacher_level includes the vendor's band, or
 *     - she already has work with that vendor (a unit done, an attempt, a certificate). Earned work is never
 *       taken away.
 *   A programme assigned by hand (niete_isaps_pilot) is an explicit choice, not a band inference, and is not gated.
 *
 * Nothing is written. The assignment rows stay as they are, so a teacher who later adds HIGH sees the vendor on her
 * next load, and one who has not started it stops seeing it when HIGH is not hers.
 *
 * Pure: no requires, no I/O, so the portal can require it in-process (tests/portal/portal-reaches-bot-modules).
 * The reads are in vendor-band-gate.service.js; every surface that turns assignments -> scopes into a training list
 * goes through it.
 */

/** vendor key -> the band a teacher must teach to be offered it. */
const BAND_ONLY_VENDORS = Object.freeze({ ISAPS: 'HIGH' });

/**
 * The programmes band selection assigns: band-selection.service PROGRAM_PRIMARY and PROGRAM_MIDDLE_HIGH (a test pins
 * the two lists together). Written out here, not required, so this module stays dependency-free.
 */
const BAND_PROGRAM_KEYS = Object.freeze(['niete_primary', 'niete_middle_high']);

/** The band a vendor needs, or null for a vendor open to every band. */
function requiredBand(vendorKey) {
  const k = String(vendorKey == null ? '' : vendorKey).trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(BAND_ONLY_VENDORS, k) ? BAND_ONLY_VENDORS[k] : null;
}

const keyOf = (keys, id) => (keys instanceof Map ? keys.get(id) : (keys || {})[id]);

/**
 * The scope rows the rule applies to: a band-only vendor reached through a band programme.
 *
 * @param {{scopes: Array<{program_id, vendor_id}>, vendorKeyById: Map|object, programKeyById: Map|object}} p
 * @returns {Array<{row: object, vendorId: *, band: string}>}
 */
function bandGatedRows({ scopes, vendorKeyById, programKeyById }) {
  const out = [];
  for (const row of scopes || []) {
    const band = requiredBand(keyOf(vendorKeyById, row.vendor_id));
    if (!band) continue;
    if (!BAND_PROGRAM_KEYS.includes(keyOf(programKeyById, row.program_id))) continue;
    out.push({ row, vendorId: row.vendor_id, band });
  }
  return out;
}

/**
 * The scope rows she sees.
 *
 * @param {object} p
 * @param {Array<object>} p.scopes training_program_scopes rows, each with program_id and vendor_id
 * @param {Map|object} p.vendorKeyById vendor id -> training_vendors.key
 * @param {Map|object} p.programKeyById program id -> training_programs.key
 * @param {string[]} p.bands her bands (teacherLevelOf)
 * @param {Set} [p.vendorIdsWithWork] vendors she already has work with
 * @returns {Array<object>} the same rows, minus those the rule hides (same array when nothing is hidden)
 */
function gateScopes({ scopes, vendorKeyById, programKeyById, bands, vendorIdsWithWork }) {
  const rows = scopes || [];
  const gated = bandGatedRows({ scopes: rows, vendorKeyById, programKeyById });
  if (gated.length === 0) return rows;
  const mine = new Set((bands || []).map(b => String(b).trim().toUpperCase()));
  const work = vendorIdsWithWork || new Set();
  const hidden = new Set(gated.filter(g => !mine.has(g.band) && !work.has(g.vendorId)).map(g => g.row));
  return hidden.size ? rows.filter(r => !hidden.has(r)) : rows;
}

module.exports = {
  BAND_ONLY_VENDORS,
  BAND_PROGRAM_KEYS,
  requiredBand,
  bandGatedRows,
  gateScopes,
};
