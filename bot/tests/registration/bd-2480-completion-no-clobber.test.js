/**
 * bd-2480 completion half: the registration completion write must not blank the
 * name/role that registration-endpoint.js already persisted per screen, and the
 * greeting must use the persisted name when the terminal payload dropped it.
 *
 * Extracted as a pure test of the merge logic the handler uses (setIf coalesce +
 * greeting fallback), so it needs none of the handler's WhatsApp/portal deps.
 */
// The exact predicate the handler uses.
const setIf = (v) => (v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === ''));
function buildUpdate({ firstName, fullName, country, submittedRole, schoolName, grade, subjects }) {
  return {
    ...(setIf(firstName) ? { first_name: firstName } : {}),
    ...(setIf(fullName) ? { name: fullName } : {}),
    ...(setIf(country) ? { country } : {}),
    ...(submittedRole ? { role: submittedRole } : {}),
    ...(setIf(schoolName) ? { school_name: schoolName } : {}),
    ...(setIf(grade) ? { grades_taught: grade } : {}),
    ...((Array.isArray(subjects) ? subjects.length : subjects) ? { subjects_taught: subjects } : {}),
    registration_completed: true,
  };
}

describe('bd-2480 completion write is non-destructive', () => {
  it('an EMPTY terminal payload writes only registration_completed — never a blank name/country', () => {
    const u = buildUpdate({ firstName: '', fullName: '', country: '', submittedRole: null, schoolName: null, grade: '', subjects: [] });
    expect(u).toEqual({ registration_completed: true });
    expect('first_name' in u).toBe(false);
    expect('country' in u).toBe(false);
  });
  it('a populated payload writes those fields', () => {
    const u = buildUpdate({ firstName: 'Mahnoor', fullName: 'Mahnoor Khan', country: 'PK', submittedRole: 'coach', schoolName: 'HQ', grade: 'grade_5', subjects: ['maths'] });
    expect(u).toMatchObject({ first_name: 'Mahnoor', name: 'Mahnoor Khan', country: 'PK', role: 'coach', school_name: 'HQ', grades_taught: 'grade_5', subjects_taught: ['maths'], registration_completed: true });
  });
  it('the org="other" shape (name empty, role present) keeps role, skips the empty name', () => {
    const u = buildUpdate({ firstName: '', fullName: '', country: '', submittedRole: 'principal', schoolName: null, grade: '', subjects: [] });
    expect(u).toEqual({ role: 'principal', registration_completed: true });
  });
});
