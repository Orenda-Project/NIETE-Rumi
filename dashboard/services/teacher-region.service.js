'use strict';
/**
 * bd-rj6w0n.14.2 — a teacher's region for the teacher app's Lesson Plans page, and her one-time choice.
 *
 * The rule is the bot's own (bot/shared/services/region.service.js, pure): users.source, then users.region,
 * then her school's schools.region. Only when none of them names it does the page ask, and the answer is
 * stored on the existing columns: users.region ('ICT' | 'Gilgit-Baltistan') while it is empty of a known
 * region, and users.school_id (a GB school) only while it is empty. Asked once; never overwritten.
 */

const { regionForUser, regionOfValue, STORED_VALUE } = require('../../bot/shared/services/region.service');

const GB = STORED_VALUE.gb;
const ok = (body) => ({ status: 200, body: { success: true, ...body } });
const bad = (error) => ({ status: 400, body: { success: false, error } });

function must({ data, error }) {
  if (error) throw new Error(error.message || 'read failed');
  return data;
}

async function readUser(supabase, userId) {
  const user = must(await supabase.from('users').select('id, region, source, school_id').eq('id', userId).maybeSingle());
  if (!user) return null;
  let schoolRegion = null;
  if (user.school_id && regionForUser(user) === 'unknown') {
    const school = must(await supabase.from('schools').select('id, region').eq('id', user.school_id).maybeSingle());
    schoolRegion = school ? school.region : null;
  }
  return { ...user, school_region: schoolRegion };
}

async function gbSchools(supabase) {
  const rows = must(await supabase.from('schools').select('id, name, region, is_active, is_probable_test')
    .eq('region', GB).eq('is_active', true).eq('is_probable_test', false).order('name'));
  return (rows || []).map((s) => ({ id: s.id, name: s.name }));
}

/** -> { region: 'ict'|'gb'|'unknown', ask, schools }. ask only for an unknown teacher who has a row. */
async function regionState(supabase, userId) {
  const user = await readUser(supabase, userId);
  const region = regionForUser(user);
  if (!user || region !== 'unknown') return { region, ask: false, schools: [] };
  return { region, ask: true, schools: await gbSchools(supabase) };
}

/** body { region: 'ict'|'gb', schoolId? } -> { status, body }. */
async function saveChoice(supabase, userId, body) {
  const b = body && typeof body === 'object' ? body : {};
  const choice = b.region;
  const schoolId = b.schoolId == null || b.schoolId === '' ? null : b.schoolId;
  if (choice !== 'ict' && choice !== 'gb') return bad('region must be ict or gb');
  if (schoolId !== null && (choice !== 'gb' || typeof schoolId !== 'string')) return bad('a school goes with gb only');

  const user = await readUser(supabase, userId);
  if (!user) return { status: 404, body: { success: false, error: 'Not found' } };
  const current = regionForUser(user);
  if (current !== 'unknown') return ok({ region: current, saved: false });

  if (schoolId) {
    const s = must(await supabase.from('schools').select('id, region, is_active, is_probable_test').eq('id', schoolId).maybeSingle());
    if (!s || regionOfValue(s.region) !== 'gb' || s.is_active !== true || s.is_probable_test === true) return bad('not a GB school');
  }
  const patch = { region: STORED_VALUE[choice] };
  if (schoolId && !user.school_id) patch.school_id = schoolId;
  const { error } = await supabase.from('users').update(patch).eq('id', userId);
  if (error) throw new Error(error.message || 'write failed');
  return ok({ region: choice, saved: true });
}

module.exports = { regionState, saveChoice };
