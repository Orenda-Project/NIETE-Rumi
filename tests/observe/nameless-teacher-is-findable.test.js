'use strict';
/**
 * A PERSON WITH NO FIRST NAME IS STILL SOMEBODY.
 *
 * Reported by a coach: a teacher's observations were "not showing in the data".
 * Both sessions existed and both reports were delivered. Her `users.first_name`
 * is an EMPTY STRING and every other name column is null, so `fullNameOf`
 * returns null and she reaches the coach's school-scoped picker as a row with
 * no title at all — a blank line the coach cannot read, cannot search for and
 * cannot tap with any confidence. 57 people with a school are in this state
 * (210 rows).
 *
 * `fullNameOf` is NOT the thing to change. Its chain is measured over 9,362
 * NIETE teachers+principals and the comment above it explains, with numbers,
 * why `first_name || ' ' || last_name` is the wrong fix. It correctly returns
 * null: we do not know her name, and inventing one is worse than showing none.
 *
 * What is missing is the step AFTER that null — a stable, non-empty LABEL so
 * the row is identifiable. The phone tail is the natural one: the coach already
 * holds her number, it is unique inside a school, and it is what the visit Flow
 * already prints on the second line of the same row.
 *
 * Two things this must NOT do, both asserted below:
 *   · invent a name — `name` stays null, because null is the truth;
 *   · leak a number into the voice call. `call-tools.repo.findRoster` reads
 *     `name` and reads it ALOUD, and never selects a phone on purpose.
 *
 * Everything here runs the real resolver over a fake supabase client — the
 * network boundary — so the changed lines actually execute.
 */

const {
  shapePatchRow, fullNameOf, toLeaderSourceRow, listPatchViaSupabase, dedupePatch,
} = require('../../bot/shared/services/observe/patch-resolver.service');
const { buildWhoPayload } = require('../../bot/shared/services/observe/observe-who.service');

const PHONE = '923001234567';
const TAIL = '4567';

/** Her actual production row: first_name is '', everything else is null. */
const NAMELESS = {
  id: 'u-nameless', phone_number: PHONE,
  first_name: '', last_name: null, name: null,
  role: 'teacher', school_id: 's-1', training_bands: null, grades_taught: null,
};
const NAMED = {
  id: 'u-named', phone_number: '923009999999',
  first_name: 'Irene', last_name: null, name: 'Irene Khan',
  role: 'teacher', school_id: 's-1', training_bands: null, grades_taught: null,
};

/** A PostgREST-shaped fake: `.select().eq()/.in()` then await. */
function fakeSupabase(people) {
  const table = (result) => {
    const q = {
      select: () => q, eq: () => q, in: () => q,
      then: (resolve) => resolve(result),
    };
    return q;
  };
  return {
    from: (name) => {
      if (name === 'leader_schools') {
        return table({ data: [{ school_ext_id: 'niete:909', school_id: null }], error: null });
      }
      if (name === 'schools') {
        return table({ data: [{ id: 's-1', name: 'Islamabad Model School', emis: '909' }], error: null });
      }
      if (name === 'users') return table({ data: people, error: null });
      return table({ data: [], error: null });
    },
  };
}

const cp = (s) => [...String(s == null ? '' : s)].length;

describe('the name chain is EXTENDED, not replaced', () => {
  test('fullNameOf still returns null — we do not know her name and will not invent one', () => {
    expect(fullNameOf(NAMELESS)).toBeNull();
    // and the measured preference order is untouched
    expect(fullNameOf({ first_name: 'Irene', last_name: null, name: 'Irene Khan' })).toBe('Irene Khan');
    expect(fullNameOf({ first_name: 'Asad', last_name: 'Amanat Ali' })).toBe('Asad Amanat Ali');
  });

  test('shapePatchRow keeps `name` null and adds a non-empty display label', () => {
    const p = shapePatchRow({ ...NAMELESS, user_id: NAMELESS.id });
    expect(p.name).toBeNull();
    expect(typeof p.displayName).toBe('string');
    expect(p.displayName.trim()).not.toBe('');
    expect(p.displayName).toContain(TAIL);
    // Not a name: it must be visibly a label, never mistaken for what she is called.
    expect(p.displayName).toMatch(/teacher/i);
  });

  test('a person WITH a name is untouched — the label is her name', () => {
    const p = shapePatchRow({ ...NAMED, user_id: NAMED.id });
    expect(p.name).toBe('Irene Khan');
    expect(p.displayName).toBe('Irene Khan');
  });

  test('the label never leaks the whole number', () => {
    const p = shapePatchRow({ ...NAMELESS, user_id: NAMELESS.id });
    expect(p.displayName).not.toContain(PHONE);
    expect(p.displayName).not.toContain('92300123');
  });
});

describe("the coach's school-scoped view", () => {
  test('resolves her from the database with a readable row title', async () => {
    const people = await listPatchViaSupabase(fakeSupabase([NAMELESS, NAMED]), 'coach-1');
    const her = people.find((p) => p.userId === 'u-nameless');
    expect(her).toBeDefined();
    expect(her.displayName).toContain(TAIL);

    // The shape the visit Flow and the "who did you observe?" list consume.
    const row = toLeaderSourceRow(her);
    expect(row.teacher_name).toBeTruthy();
    expect(row.teacher_name).toContain(TAIL);
    expect(cp(row.teacher_name)).toBeLessThanOrEqual(24);
  });

  test('the "who did you observe?" list renders a title, not a blank line', async () => {
    const people = await listPatchViaSupabase(fakeSupabase([NAMELESS, NAMED]), 'coach-1');
    const rows = people.map(toLeaderSourceRow);
    const S = { who_body: 'b', who_button: 'Pick', who_section: 'People', who_other: 'Someone else', who_other_desc: 'd' };
    const payload = buildWhoPayload(rows, S, 'sess-1');
    const titles = payload.action.sections[0].rows.map((r) => r.title);
    for (const t of titles) {
      expect(t.trim()).not.toBe('');
      expect(cp(t)).toBeLessThanOrEqual(24);
    }
    expect(titles.some((t) => t.includes(TAIL))).toBe(true);
  });

  test('dedupe still orders on something stable, with the nameless row present', () => {
    const out = dedupePatch([
      shapePatchRow({ ...NAMELESS, user_id: 'u-nameless' }),
      shapePatchRow({ ...NAMED, user_id: 'u-named' }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((p) => p.userId).sort()).toEqual(['u-named', 'u-nameless']);
  });
});

describe('the voice call must not read a number aloud', () => {
  test('the roster projection (call-tools reads `name`) carries no phone digits', () => {
    // call-tools.repo.findRoster maps `teacher_name: p.name` and deliberately
    // never selects a phone. The label must not sneak in through that door.
    const p = shapePatchRow({ ...NAMELESS, user_id: NAMELESS.id });
    expect(p.name == null || !/\d/.test(p.name)).toBe(true);
  });
});
