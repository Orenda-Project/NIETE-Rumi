/**
 * bd-gc1ge — the /remark roster must not print "null" at a principal.
 *
 * Found while sweeping for the same class of defect as the photo-gate greeting.
 * `buildRoster` rendered each line as:
 *
 *     `${i + 1}. ${t.name} — ${status}`
 *
 * with `t.name` straight off the `users` row that remark-cycle.repository
 * selects (`listSchoolTeachers`, select 'id, phone_number, preferred_language,
 * name'). On NIETE prod 6,282 of 15,552 users have `name IS NULL`, so a
 * principal whose school has a nameless teacher read "1. null — ⬜ Not started".
 *
 * The feature ALREADY owns the right helper: remark-screens :: renderTeacherName
 * falls back to "Teacher <last 4 of phone>" and then to a generic label, in en
 * or ur — and the Flow screens in this same feature have always used it. Only
 * the plain-text roster bypassed it.
 */

'use strict';

const { buildRoster, STRINGS } = require('../../shared/handlers/remark-command.handler');

const progress = {};

function roster(teachers, language = 'en') {
  return buildRoster(teachers, progress, STRINGS[language] || STRINGS.en, 'Term 1', language);
}

describe('bd-gc1ge — /remark roster with a nameless teacher', () => {
  test('name IS NULL does not render the literal "null"', () => {
    const out = roster([{ id: 't1', name: null, phone_number: '923001234567' }]);

    expect(out).not.toMatch(/\bnull\b/);
    expect(out).not.toMatch(/\bundefined\b/);
    // The phone tail is what a principal can actually recognise her by.
    expect(out).toContain('4567');
  });

  test("name = '' does not render an empty gap either", () => {
    const out = roster([{ id: 't2', name: '', phone_number: '923009998888' }]);

    expect(out).not.toMatch(/\bnull\b/);
    expect(out).toContain('8888');
    // "1.  — ⬜" — a dash with nothing before it is the empty-gap shape.
    expect(out).not.toMatch(/\d\.\s+—/);
  });

  test('a named teacher is unchanged', () => {
    const out = roster([{ id: 't3', name: 'Ayesha Bibi', phone_number: '923001112222' }]);

    expect(out).toContain('Ayesha Bibi');
    expect(out).not.toMatch(/\bnull\b/);
  });

  test('an Urdu-reading principal gets the Urdu fallback label, not an English one', () => {
    const out = roster([{ id: 't4', name: null, phone_number: '923004445555' }], 'ur');

    expect(out).not.toMatch(/\bnull\b/);
    expect(out).toContain('5555');
    // renderTeacherName's ur label is "استاد <tail>" — the English "Teacher"
    // must not be what an Urdu roster falls back to.
    expect(out).toMatch(/[؀-ۿ]/);
    expect(out).not.toMatch(/\bTeacher\b/);
  });

  test('a mixed roster keeps every row addressable', () => {
    const out = roster([
      { id: 'a', name: 'Sara Khan', phone_number: '923001111111' },
      { id: 'b', name: null, phone_number: '923002222222' },
      { id: 'c', name: '', phone_number: '923003333333' },
    ]);

    expect(out).not.toMatch(/\bnull\b/);
    expect(out).not.toMatch(/\bundefined\b/);
    expect(out).toContain('Sara Khan');
    expect(out).toContain('2222');
    expect(out).toContain('3333');
  });
});
