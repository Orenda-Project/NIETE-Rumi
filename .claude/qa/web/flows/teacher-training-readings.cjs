// teacher-training-readings — the hand-written TT04: an I-SAPS module page carries the partner's required reading
// (bd-yef5iq.6 + bd-gbf8ix). Joined to the generated teacher-training driver by .claude/qa/web/gen_page_features.py
// (EXTRA), so spec and driver still come from one place.
//
// The reading list is matched on the vendor KEY ('ISAPS'): the vendor's display name was renamed on 2026-10-13 and
// every module page lost its list (readings: null). This drives the real route as the signed-in demo teacher —
// GET /api/portal/training/modules for an I-SAPS course — and checks the list the page renders.
//
// BLOCKED, with the reason, when this run's database has no I-SAPS course the demo teacher can open (the demo school
// network seeds none today); the rule itself is pinned by tests/training/bd-yef5iq-6-isaps-level2-readings.test.js.
'use strict';
const { asRole } = require('../lib.cjs');

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
    await asRole(page, ctx, 'teacher', 'teacherV2');
    const res = await page.evaluate(async (id) => {
      const r = await fetch('/api/portal/training/modules?course_id=' + encodeURIComponent(id), { credentials: 'include' });
      return { status: r.status, body: await r.json().catch(() => null) };
    }, courseId);
    if (res.status === 403 || res.status === 404) {
      return { blocked: 'the demo teacher cannot open I-SAPS course ' + courseId + ' (HTTP ' + res.status + ') — not assigned to an I-SAPS programme here' };
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
