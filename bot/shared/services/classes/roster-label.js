/**
 * The label for one roster row — `student_lists` as the teacher should read it.
 *
 * ONE implementation, deliberately. This rule lived in two places (the marking
 * endpoint's `listLabel` and the router's `classLabel`) and the duplication is what
 * shipped "Grade 11 - B - B" and a "Grade 7 - E (evening) - " truncated at the 24-char
 * WhatsApp row cap. Anything that needs to name a class imports this.
 */

/**
 * A class-backed mirror row already carries section AND shift inside class_name
 * (ClassService.mirrorLabel), so appending `section` renders "Grade 11 - B - B"
 * and pushes "Grade 7 - E (evening) - E" past the 24-char row cap (bd-2725).
 * The mirror owns the label for those rows; legacy rows compose it.
 */
function rosterLabel(row) {
  if (!row) return 'Your class';
  const name = String(row.class_name || '').trim();
  const section = row.section ? String(row.section).trim() : '';
  if (!section) return name;
  // Append the section only if the name does not already end with it. The mirror
  // has carried BOTH shapes on the same day — "Grade 11 - B" + section "B"
  // (doubling to "Grade 11 - B - B"), and later "Grade 11" + section "B" (where
  // dropping the section loses it). Shift-bearing names like
  // "Grade 7 - E (evening)" must not gain a second "- E" either. Comparing the
  // tail is stable across all three. (bd-2725)
  const endsWithSection = new RegExp(`(^|[\\s\\-])${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(\\(|$)`, 'i');
  return endsWithSection.test(name) ? name : `${name} - ${section}`;
}

/** WhatsApp caps an interactive list row title at 24 code points. */
const ROW_TITLE_CAP = 24;

/** The same label, clipped for a chat list row. */
function rosterRowTitle(row) {
  return [...rosterLabel(row)].slice(0, ROW_TITLE_CAP).join('');
}

module.exports = { rosterLabel, rosterRowTitle, ROW_TITLE_CAP };
