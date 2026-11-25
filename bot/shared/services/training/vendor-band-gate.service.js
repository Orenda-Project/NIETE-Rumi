'use strict';
/**
 * bd-r2uzg1.18.1 — the reads behind vendor-band-gate.rules: may this teacher see a band-only provider (I-SAPS)?
 *
 * One implementation for both surfaces. It takes the CALLER'S supabase client and requires only pure modules, so the
 * bot (WhatsApp Flow catalogue, level and exam gates) and the portal (GET /training/vendors, GET /training/levels)
 * run the same code in-process. Every surface that turns teacher_training_assignments -> training_program_scopes
 * into a training list passes its scope rows (with program_id and vendor_id) through gateTeacherScopes first.
 *
 * Cheap for almost everyone: two small key lookups, then nothing more unless a band programme brings in a band-only
 * vendor. Her teacher_level is read only then, and her work with the vendor only when the band is not hers.
 *
 * FAILS OPEN: a read that errors leaves the rows as they were, i.e. the list she had before this rule. Hiding
 * training she has earned because of a transient error would be worse than showing an extra provider.
 */

const Rules = require('./vendor-band-gate.rules');
const { teacherLevelOf } = require('../../utils/teacher-level');

const uniq = (xs) => [...new Set(xs.filter(x => x != null))];

/** True when the query finds at least one row; throws on a read error. */
async function any(query) {
  const { data, error } = await query.limit(1);
  if (error) throw error;
  return Array.isArray(data) ? data.length > 0 : !!data;
}

/**
 * The vendors (of those given) she already has work with: a certificate or an attempt on one of its levels, or a
 * progress row on one of its units. Inactive levels and units count too: earned is earned.
 */
async function vendorIdsWithWork(supabase, userId, vendorIds) {
  const withWork = new Set();
  for (const vendorId of vendorIds) {
    const { data: levels, error: lErr } = await supabase
      .from('training_levels').select('id').eq('vendor_id', vendorId);
    if (lErr) throw lErr;
    const levelIds = (levels || []).map(l => l.id);
    if (levelIds.length === 0) continue;

    const [hasCert, hasAttempt, courses] = await Promise.all([
      any(supabase.from('training_certificates').select('level_id').eq('user_id', userId).in('level_id', levelIds)),
      any(supabase.from('training_assessment_attempts').select('level_id').eq('user_id', userId).in('level_id', levelIds)),
      supabase.from('training_courses').select('id').in('level_id', levelIds),
    ]);
    if (hasCert || hasAttempt) { withWork.add(vendorId); continue; }
    if (courses.error) throw courses.error;
    const courseIds = (courses.data || []).map(c => c.id);
    if (courseIds.length === 0) continue;

    const { data: modules, error: mErr } = await supabase
      .from('training_modules').select('id').in('course_id', courseIds);
    if (mErr) throw mErr;
    const moduleIds = (modules || []).map(m => m.id);
    if (moduleIds.length && await any(supabase
      .from('teacher_training_progress').select('module_id').eq('user_id', userId).in('module_id', moduleIds))) {
      withWork.add(vendorId);
    }
  }
  return withWork;
}

/**
 * Her scope rows with the band-only providers she may not see taken out.
 *
 * @param {object} supabase the caller's client (bot or portal)
 * @param {string} userId
 * @param {Array<{program_id, vendor_id}>} scopes training_program_scopes rows of her ACTIVE assignments
 * @returns {Promise<Array<object>>} the rows she sees (the same rows on any read error)
 */
async function gateTeacherScopes(supabase, userId, scopes) {
  const rows = Array.isArray(scopes) ? scopes : [];
  if (!userId || rows.length === 0) return rows;
  try {
    const vendorIds = uniq(rows.map(s => s.vendor_id));
    const programIds = uniq(rows.map(s => s.program_id));
    if (vendorIds.length === 0 || programIds.length === 0) return rows;

    const [vendors, programs] = await Promise.all([
      supabase.from('training_vendors').select('id, key').in('id', vendorIds),
      supabase.from('training_programs').select('id, key').in('id', programIds),
    ]);
    if (vendors.error || programs.error) return rows;
    const vendorKeyById = new Map((vendors.data || []).map(v => [v.id, v.key]));
    const programKeyById = new Map((programs.data || []).map(p => [p.id, p.key]));

    const gated = Rules.bandGatedRows({ scopes: rows, vendorKeyById, programKeyById });
    if (gated.length === 0) return rows;

    const { data: user, error: uErr } = await supabase
      .from('users').select('id, teacher_level').eq('id', userId).maybeSingle();
    if (uErr) return rows;
    const bands = teacherLevelOf(user);

    const unmet = uniq(gated.filter(g => !bands.includes(g.band)).map(g => g.vendorId));
    if (unmet.length === 0) return rows;

    const work = await vendorIdsWithWork(supabase, userId, unmet);
    return Rules.gateScopes({ scopes: rows, vendorKeyById, programKeyById, bands, vendorIdsWithWork: work });
  } catch (_) {
    return rows;
  }
}

module.exports = { gateTeacherScopes, vendorIdsWithWork };
