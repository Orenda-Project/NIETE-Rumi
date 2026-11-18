/**
 * The school key a patch person is booked and recorded under: 'niete:' + the school's EMIS, else the key of the
 * holding the coach reached that school by (a school with no EMIS, such as the GB community schools and the Rumi QA
 * test schools, is keyed by its name in leader_schools). null only when neither exists, never the string 'niete:null'.
 *
 * observation_schedules.school_ext_id is NOT NULL, so every writer of that table takes its key from here (the bot) or
 * from the same rule in SQL, COALESCE('niete:' || s.emis, ls.school_ext_id) (the portal: leader-schedule-write,
 * leader-patch). Pure, with no requires, so a test that mocks patch-resolver cannot drop it.
 *
 * @param {{emis?: string|number|null, schoolExtId?: string|null}|null|undefined} p  a patch person
 * @returns {string|null}
 */
function schoolKeyOf(p) {
  if (!p) return null;
  return p.emis ? `niete:${p.emis}` : (p.schoolExtId || null);
}

module.exports = { schoolKeyOf };
