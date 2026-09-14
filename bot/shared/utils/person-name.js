/**
 * bd-60092 — the ONE place a person's name is resolved.
 *
 * `users.name` is the only name column. `first_name` and `last_name` were
 * dropped: they bought nothing a split cannot compute, and cost three writers
 * disagreeing about what `name` meant (feature-registration wrote a FIRST name
 * into it, flow-response a FULL name, observe-teacher-admin wrote the full name
 * into `first_name`).
 *
 * Measured on NIETE prod, 2026-09-14, across 14,574 users:
 *   · `name` populated 9,037 · `first_name` 7,376 · `last_name` 4,306
 *   · 5,494 carried NONE of the three — and every one of them has a phone
 *   · dropping first+last destroyed nothing: for the 5,494 they were already
 *     empty, and for the 9,037 with a `name` they were redundant
 *
 * Every caller that shows a person to a human goes through here, so the
 * nameless degrade to a phone in ONE place rather than 48.
 */

'use strict';

/** Trim and collapse internal whitespace. FDE ships 6 names with double spaces. */
const _norm = (s) => String(s == null ? '' : s).trim().replace(/\s+/g, ' ');

/**
 * The person's whole name, or null.
 *
 * Returns null rather than '' so a caller cannot accidentally render an empty
 * string where a name belongs — the blank rows in the Add/Remove teacher picker
 * that opened this bead were exactly that.
 */
function fullNameOf(person = {}) {
  return _norm(person && person.name) || null;
}

/**
 * The first word of the person's name, or null.
 *
 * A first name is a DISPLAY concern, computed at render time. Storing it is
 * what let it drift from `name` on 6,820 rows.
 */
function firstNameOf(person = {}) {
  const full = fullNameOf(person);
  return full ? full.split(' ')[0] : null;
}

/**
 * A name for a human to read, falling back to the phone when there is none.
 *
 * 5,494 people on prod have no name. They must never render as '', 'null' or
 * 'undefined' to a coach — the phone is what the coach can actually act on.
 */
function displayNameOf(person = {}, fallback = null) {
  return fullNameOf(person)
    || (person && person.phone_number ? String(person.phone_number) : null)
    || fallback;
}

/**
 * Title-case a name for storage.
 *
 * Operator decision, 2026-09-14: the FDE backfill title-cases ON WRITE. 79% of
 * the 1,596 recoverable names arrive upper-case ("BAKAR SHAH"), and writing
 * them verbatim would put them beside "Anwar Saifullah" in the same picker.
 *
 * Deliberately simple: it lower-cases the tail of each whitespace-separated
 * word and leaves a one-letter word as a capital ("M HUMAYON RASHEED" ->
 * "M Humayon Rasheed"). It does NOT try to be clever about particles or
 * patronymics — a wrong guess is stored data, and this runs over an import we
 * are treating as authoritative.
 */
function titleCaseName(value) {
  const s = _norm(value);
  if (!s) return null;
  return s
    .split(' ')
    .map((w) => (w.length === 1 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

module.exports = { fullNameOf, firstNameOf, displayNameOf, titleCaseName, _norm };
