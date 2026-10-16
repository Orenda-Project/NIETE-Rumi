/**
 * Who still needs the registration form — ONE predicate, read by every unprompted door.
 *
 * isRegistered() is true for anyone with a name, which is right for a conversational gate
 * ("we know who she is") and wrong for "is her account usable". Production, 2026-10-16:
 * ~1,007 adults who have messaged the bot carry a name from a roster or a coach but no
 * school or no real role, and anyone who quits the v5 form after its first screen keeps the
 * name it saved. Keyed on isRegistered(), none of them was ever offered the form.
 *
 * The operator's rule: offer it to an adult who is not a child, not an admin-set coach/AEO,
 * has not completed the form, and is missing any of a name, a school, or a form role
 * (teacher/principal). A roster row with all three is complete. A feature that needs a
 * school asks any such adult without one, completed or not.
 */
const { needsRegistrationForm, needsSchoolForFeature, isRegistered } = require('../../bot/shared/utils/registration-status');

const row = (over = {}) => ({
  id: 'u1', name: null, school_id: null, role: null,
  registration_completed: false, registration_state: 'unregistered', ...over,
});

describe('needsRegistrationForm / needsSchoolForFeature', () => {
  test.each([
    // label,                                   user,                                                                   form,  school
    ['brand-new (no name, default role)',        row({ role: 'teacher' }),                                                true,  true],
    ['name only',                                row({ name: 'Ayesha Bano' }),                                            true,  true],
    ['empty-string name is not a name',          row({ name: '  ', school_id: 's1', role: 'teacher' }),                   true,  false],
    ['name + school, no role',                   row({ name: 'Ayesha Bano', school_id: 's1' }),                           true,  false],
    ["name + school, role 'unregistered'",       row({ name: 'Ayesha Bano', school_id: 's1', role: 'unregistered' }),     true,  false],
    ['name + teacher, no school',                row({ name: 'Ayesha Bano', role: 'teacher' }),                           true,  true],
    ['name + school + teacher (roster, flag false) is complete', row({ name: 'Ayesha Bano', school_id: 's1', role: 'teacher' }), false, false],
    ['name + school + principal is complete',    row({ name: 'Ayesha Bano', school_id: 's1', role: 'principal' }),        false, false],
    ['completed the form, no school',            row({ name: 'Ayesha Bano', role: 'teacher', registration_completed: true }), false, true],
    ['coach — admin-set, never',                 row({ name: 'Rifat', role: 'coach' }),                                   false, false],
    ['AEO — admin-set, never',                   row({ name: 'Imran', role: 'aeo' }),                                     false, false],
    ["a child's quiz phone — never",             row({ persona: 'student' }),                                             false, false],
    ['no account at all',                        null,                                                                    false, false],
  ])('%s', (_label, user, form, school) => {
    expect(needsRegistrationForm(user)).toBe(form);
    expect(needsSchoolForFeature(user)).toBe(school);
  });

  test('a name alone still counts for isRegistered() — the conversational gate is unchanged', () => {
    expect(isRegistered(row({ name: 'Ayesha Bano' }))).toBe(true);
    expect(needsRegistrationForm(row({ name: 'Ayesha Bano' }))).toBe(true);
  });
});
