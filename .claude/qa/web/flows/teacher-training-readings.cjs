// teacher-training-readings — the hand-written TT04: an I-SAPS module page carries the partner's required reading
// (bd-yef5iq.6 + bd-gbf8ix). Joined to the generated teacher-training driver by .claude/qa/web/gen_page_features.py
// (EXTRA), so spec and driver still come from one place.
//
// The reading list is matched on the vendor KEY ('ISAPS'): the vendor's display name was renamed on 2026-10-13 and
// every module page lost its list (readings: null). This drives the real route as the signed-in demo teacher —
// GET /api/portal/training/modules for an I-SAPS course — and checks the list the page renders.
//
// The demo school network assigns the demo teacher only niete_standard, whose scope has no I-SAPS (the course answered
// 404 "Level not found": not in her programme). So the run assigns her, in THIS run's own database only, a programme of
// its own (key e2e_isaps_readings, not a band-gated programme key) scoped to the I-SAPS vendor, and removes the programme,
// its scope and the assignment afterwards. BLOCKED, with the reason, only when the run's database has no I-SAPS course at
// all; the rule itself is also pinned by tests/training/bd-yef5iq-6-isaps-level2-readings.test.js.
'use strict';
const { asRole } = require('../lib.cjs');

const PROGRAM_KEY = 'e2e_isaps_readings';
const TEACHER_PHONE_SQL = "(select id from users where phone_number = '923000000911')";

// Her own I-SAPS programme in this run's database: the programme, one scope (the I-SAPS vendor, every level), and an
// active assignment. Idempotent; undone by unassign().
async function assignIsaps(ctx) {
  await ctx.sql("insert into training_programs (key, name, is_active) values ('" + PROGRAM_KEY + "', 'E2E I-SAPS readings', true) "
    + 'on conflict (key) do update set is_active = true');
  await ctx.sql('insert into training_program_scopes (program_id, vendor_id) '
    + "select p.id, v.id from training_programs p, training_vendors v where p.key = '" + PROGRAM_KEY + "' and v.key = 'ISAPS' "
    + 'and not exists (select 1 from training_program_scopes s where s.program_id = p.id and s.vendor_id = v.id)');
  await ctx.sql("insert into teacher_training_assignments (user_id, program_id, assigned_by, is_active) "
    + 'select ' + TEACHER_PHONE_SQL + ", p.id, 'e2e_web', true from training_programs p where p.key = '" + PROGRAM_KEY + "' "
    + 'and not exists (select 1 from teacher_training_assignments a where a.program_id = p.id and a.is_active)');
}
async function unassign(ctx) {
  const prog = "(select id from training_programs where key = '" + PROGRAM_KEY + "')";
  await ctx.sql('delete from teacher_training_assignments where program_id = ' + prog);
  await ctx.sql('delete from training_program_scopes where program_id = ' + prog);
  await ctx.sql("delete from training_programs where key = '" + PROGRAM_KEY + "'");
}

const ISAPS_COURSE_SQL =
  "select c.id || '|' || l.order_index || '|' || c.title from training_courses c "
  + 'join training_levels l on l.id = c.level_id join training_vendors v on v.id = l.vendor_id '
  + "where v.key = 'ISAPS' and l.is_active and c.is_active and c.title ~ '^Module 1\\M' order by l.order_index limit 1";

module.exports = [{
  id: 'TT04',
  title: "An I-SAPS module page shows the partner's required reading, under the renamed programme",
  run: async (page, ctx) => {
    const row = String(await ctx.sql(ISAPS_COURSE_SQL) || '').trim();
    if (!row) return { blocked: 'no active I-SAPS course in this run\'s database (the demo school network seeds none)' };
    const [courseId, levelOrder, title] = row.split('|');
    await assignIsaps(ctx);
    let res;
    try {
      await asRole(page, ctx, 'teacher', 'teacherV2');
      res = await page.evaluate(async (id) => {
        const r = await fetch('/api/portal/training/modules?course_id=' + encodeURIComponent(id), { credentials: 'include' });
        return { status: r.status, body: await r.json().catch(() => null) };
      }, courseId);
    } finally {
      await unassign(ctx);
    }
    const readings = res.body && res.body.readings;
    const first = readings && readings.available && readings.available[0];
    if (res.status !== 200 || !first || !/^https?:\/\//.test(first.url || '')) {
      throw new Error('I-SAPS course ' + courseId + ' (' + title + ', level order ' + levelOrder + ') returned HTTP '
        + res.status + ' with readings ' + JSON.stringify(readings).slice(0, 200));
    }
    return { courseId, title, levelOrder: Number(levelOrder), readings: readings.available.length, first: first.title };
  },
}];
