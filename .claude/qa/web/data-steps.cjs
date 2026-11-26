// data-steps — the web lane's data steps (bd-5b3u70.16): what a portal action saved, read from the run's own database
// through ctx.rows / snapshot / dataRules (data-api.cjs). A result's data part is the bot lane's shape —
// { ok, data: 'checked' | 'NOT CHECKED: …' | 'ERROR: …' } — so the run row's data summary (engine ledger_row.py) and
// the QA dashboard count it the same way. NOT CHECKED (no run database, a runner or engine without data reads) never
// fails a scenario; an ERROR on the run's own database does: a broken check must never stay green.
// Tests: test_data_steps.js.
'use strict';

const NO_READS = 'this web runner has no data reads (ctx.dataKeys) — an older checkout';

/** The watched tables as they are now: take it when the scenario's set-up ends, before the action. */
async function dataBefore(ctx) {
  if (!ctx || typeof ctx.dataKeys !== 'function') return { notChecked: NO_READS };
  const keys = ctx.dataKeys();
  if (!keys.ok) return keys.notChecked ? { notChecked: keys.notChecked } : { error: keys.error };
  const s = await ctx.snapshot(keys.watch);
  if (!s.ok) return s.notChecked ? { notChecked: s.notChecked } : { error: s.error };
  return { watch: keys.watch, snap: s.snap };
}

/** After an add-students save: the class's active enrolments are rolls 1..n holding `names` as typed, every child is
 *  active, and nothing outside this class and its list was added, changed or removed, with no child on it twice. */
async function rosterVerdict(ctx, before, classId, names) {
  if (before.notChecked) return { ok: true, data: 'NOT CHECKED: ' + before.notChecked };
  if (before.error) return { ok: false, data: 'ERROR: ' + before.error };
  const fail = (r) => ({ ok: false, data: 'ERROR: ' + (r.error || r.notChecked || 'no answer') });

  const enr = await ctx.rows('class_enrollments', { class_id: classId });
  if (!enr.ok) return fail(enr);
  const onRoll = enr.rows.filter((e) => e.is_active !== false && !e.left_on).sort((a, b) => a.roll_number - b.roll_number);
  const got = [];
  for (const e of onRoll) {
    const s = await ctx.rows('students', { id: e.student_id });
    if (!s.ok) return fail(s);
    const kid = s.rows[0] || {};
    got.push([e.roll_number, kid.student_name === undefined ? null : kid.student_name, kid.is_active !== false]);
  }
  const want = names.map((n, i) => [i + 1, n, true]);
  const mismatch = JSON.stringify(got) === JSON.stringify(want) ? null : { saved: got.length, expected: want.length,
    rolls: got.map((g) => g[0]), namesAsTyped: got.every((g, i) => want[i] && g[1] === want[i][1]), allActive: got.every((g) => g[2]) };

  const lists = await ctx.rows('student_lists', { class_id: classId });
  if (!lists.ok) return fail(lists);
  const rules = await ctx.dataRules(before.watch, [classId, ...lists.rows.map((l) => l.id)], before.snap);
  if (!rules.ok) return rules.notChecked ? { ok: true, data: 'NOT CHECKED: ' + rules.notChecked } : fail(rules);

  const out = { ok: !mismatch && !rules.owner.length && !rules.duplicates.length, data: 'checked',
    owner: rules.owner, duplicates: rules.duplicates };
  if (mismatch) out.mismatch = mismatch;
  return out;
}

module.exports = { dataBefore, rosterVerdict };
