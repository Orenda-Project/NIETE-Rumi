/**
 * A coach's schools resolve by `school_id`, not by string-splitting an id.
 *
 * `listPatchViaSupabase` derived the school by splitting `school_ext_id` on ':'
 * and matching the tail against `schools.emis`. Its sibling in the same file,
 * PATCH_SQL, joins on `school_id` with the text form only as a fallback. Two
 * functions, two rules, same question — so a row can satisfy one and fail the
 * other, and the picker silently returns "no matches - try again" with no error
 * anywhere.
 *
 * That is exactly what happened: a holding with a valid `school_id` but an
 * ext_id of `test:sandbox` resolved to emis 'sandbox', matched no school, and
 * emptied the roster. Measured on production: 482 of 487 holdings already carry
 * `school_id`, and the 5 that do not are `test:*` fixtures — so keying on the
 * FK strictly improves on the string parse.
 */

const { schoolIdsForHoldings } = require('../../bot/shared/services/observe/patch-resolver.service');

describe('schoolIdsForHoldings — the FK is the link', () => {
  it('uses school_id and ignores the shape of the ext_id entirely', () => {
    // The bug: 'test:sandbox' has no emis tail to match, but the FK is right
    // there. Nothing about the text form should decide whether a coach has a
    // roster.
    expect(schoolIdsForHoldings([
      { school_ext_id: 'test:sandbox', school_id: 'sch-1' },
    ])).toEqual(['sch-1']);
  });

  it('still resolves the ordinary niete:<emis> holdings', () => {
    expect(schoolIdsForHoldings([
      { school_ext_id: 'niete:411', school_id: 'sch-a' },
      { school_ext_id: 'niete:203', school_id: 'sch-b' },
    ])).toEqual(['sch-a', 'sch-b']);
  });

  it('de-duplicates a school held twice', () => {
    // Production carries duplicate holdings; a repeated id would fan the
    // roster query out for nothing.
    expect(schoolIdsForHoldings([
      { school_ext_id: 'niete:411', school_id: 'sch-a' },
      { school_ext_id: 'niete:411', school_id: 'sch-a' },
    ])).toEqual(['sch-a']);
  });

  it('drops a holding with no school_id rather than guessing from the text', () => {
    // The 5 production rows in this state are all test:* fixtures. Falling back
    // to the string parse is what made the two resolvers disagree; a holding
    // that cannot name its school is not a holding.
    expect(schoolIdsForHoldings([
      { school_ext_id: 'test:9001', school_id: null },
      { school_ext_id: 'niete:411', school_id: 'sch-a' },
    ])).toEqual(['sch-a']);
  });

  it('is empty, not throwing, for junk input', () => {
    // A failed fetch must not take the whole picker down with it.
    expect(schoolIdsForHoldings(null)).toEqual([]);
    expect(schoolIdsForHoldings([])).toEqual([]);
    expect(schoolIdsForHoldings([{}])).toEqual([]);
  });
});

describe('the menu says what it does', () => {
  const fs = require('fs');
  const path = require('path');
  const FLOW = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../../docs/flows/observe-visit-v2.json'), 'utf8'));
  const screen = (id) => FLOW.screens.find((s) => s.id === id);

  it('TEACHER_ACTION is titled for all three actions, not two', () => {
    // It read "Add or remove" after Edit shipped — a title that tells a coach
    // the thing she is looking at is not available.
    expect(screen('TEACHER_ACTION').title).toBe('Manage teachers');
  });

  it('still offers exactly add, remove and edit', () => {
    const radio = screen('TEACHER_ACTION').layout.children
      .find((c) => c.type === 'Form').children
      .find((c) => c.type === 'RadioButtonsGroup');
    expect(radio['data-source'].map((o) => o.id)).toEqual(['add', 'remove', 'edit']);
  });
});
