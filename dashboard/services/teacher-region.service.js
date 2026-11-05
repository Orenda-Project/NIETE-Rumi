'use strict';
/**
 * bd-rj6w0n.14.2 — a teacher's region for the teacher app's Lesson Plans page, and her one-time choice.
 *
 * The rule is the bot's own (bot/shared/services/region.service.js, on the region registry of bd-97daxo.2):
 * users.source, then users.region, then her school's schools.region. Only when none of them names it does the
 * page ask, and the answer is stored on the existing columns, spelt as the registry spells it: users.region =
 * her ICT sector or the GB region, while it is empty of a known region, and users.school_id (a GB school) only
 * while it is empty. Asked once; never overwritten.
 */

const { regionForUser, regionOfValue, regionsFor } = require('../../bot/shared/services/region.service');

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
  if (user.school_id && (await regionForUser(supabase, user)) === 'unknown') {
    const school = must(await supabase.from('schools').select('id, region').eq('id', user.school_id).maybeSingle());
    schoolRegion = school ? school.region : null;
  }
  return { ...user, school_region: schoolRegion };
}

async function gbSchools(supabase) {
  const rows = must(await supabase.from('schools').select('id, name, region, is_active, is_probable_test')
    .in('region', await regionsFor(supabase, 'gb')).eq('is_active', true).eq('is_probable_test', false).order('name'));
  return (rows || []).map((s) => ({ id: s.id, name: s.name }));
}

/** -> { region: 'ict'|'gb'|'unknown', ask, sectors, schools }. ask only for an unknown teacher who has a row. */
async function regionState(supabase, userId) {
  const user = await readUser(supabase, userId);
  const region = await regionForUser(supabase, user);
  if (!user || region !== 'unknown') return { region, ask: false, sectors: [], schools: [] };
  return { region, ask: true, sectors: await regionsFor(supabase, 'ict'), schools: await gbSchools(supabase) };
}

/** body { region: 'ict', sector } | { region: 'gb', schoolId? } -> { status, body }. */
async function saveChoice(supabase, userId, body) {
  const b = body && typeof body === 'object' ? body : {};
  const choice = b.region;
  const schoolId = b.schoolId == null || b.schoolId === '' ? null : b.schoolId;
  if (choice !== 'ict' && choice !== 'gb') return bad('region must be ict or gb');
  if (choice === 'ict' && (schoolId !== null || typeof b.sector !== 'string')) return bad('ict takes a sector and no school');
  if (choice === 'gb' && (b.sector !== undefined || (schoolId !== null && typeof schoolId !== 'string'))) return bad('gb takes a school only');

  const user = await readUser(supabase, userId);
  if (!user) return { status: 404, body: { success: false, error: 'Not found' } };
  const current = await regionForUser(supabase, user);
  if (current !== 'unknown') return ok({ region: current, saved: false });

  // The value written is always one the registry lists, exactly as it lists it.
  const listed = await regionsFor(supabase, choice);
  let value;
  if (choice === 'ict') {
    value = listed.find((r) => r === b.sector);
    if (!value) return bad('not an ICT sector');
  } else {
    if (schoolId) {
      const s = must(await supabase.from('schools').select('id, region, is_active, is_probable_test').eq('id', schoolId).maybeSingle());
      if (!s || (await regionOfValue(supabase, s.region)) !== 'gb' || s.is_active !== true || s.is_probable_test === true) return bad('not a GB school');
      value = listed.find((r) => r.trim().toLowerCase() === s.region.trim().toLowerCase());
    } else if (listed.length === 1) {
      [value] = listed;
    }
    if (!value) return bad('pick your school');
  }
  const patch = { region: value };
  if (schoolId && !user.school_id) patch.school_id = schoolId;
  const { error } = await supabase.from('users').update(patch).eq('id', userId);
  if (error) throw new Error(error.message || 'write failed');
  return ok({ region: choice, saved: true });
}

module.exports = { regionState, saveChoice };
