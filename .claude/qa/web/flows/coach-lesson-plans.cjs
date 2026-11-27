// coach-lesson-plans — the hand-written coach-portal scenario for the coach app's Lesson Plans tab (bd-4joiqz; driver
// code bd-q8wt5e.6.6): a coach on the coach app v2 reads the teacher Lesson Plans pages as a leader, and her other
// teacher pages still land on the Training Library. Joined to the generated coach-portal driver by
// .claude/qa/web/gen_page_features.py (EXTRA).
//
// Since 0dedffdf5 (27 Oct 2026) "My schools" is ready on the coach app too (CP02), so the menu reads Training Library,
// Lesson Plans, My schools, More: the check is that Training Library, Lesson Plans and More are there in that order,
// and the full menu is kept in the evidence.
'use strict';
const L = require('./lessons-lib.cjs');

const scenarios = [
  { id: 'LDR07', title: 'Coach app v2: Lesson Plans is in their menu and opens the Lesson Plans pages; their other pages still land on the Training Library',
    run: async (page, ctx) => L.withSettings(ctx, L.modeSettings('coachV2'), async () => {
      L.watch(page);
      await L.asRole(page, ctx, 'coach');
      await L.go(page, ctx, '/portal/coach/training');
      const m = (await L.menu(page)).map((i) => i.text);
      L.expect(L.inOrder(m, ['Training Library', 'Lesson Plans', 'More']), 'menu is not Training Library, Lesson Plans, More: ' + JSON.stringify(m));
      const atNew = await L.go(page, ctx, '/portal/teacher/lessons/new');
      L.expect(atNew.startsWith('/portal/teacher/lessons/new'), '/portal/teacher/lessons/new settled on ' + atNew);
      await L.seeText(page, /New lesson plan/, '/portal/teacher/lessons/new');
      const atCoaching = await L.go(page, ctx, '/portal/teacher/coaching');
      L.expect(atCoaching.startsWith('/portal/coach/training'), '/portal/teacher/coaching settled on ' + atCoaching + ', not /portal/coach/training');
      const atAll = await L.go(page, ctx, '/portal/teacher/lessons/all');
      L.expect(!atAll.startsWith('/portal/teacher/lessons/all'), '/portal/teacher/lessons/all opened for a coach');
      L.healthy(page);
      return { menu: m, lessonsNew: atNew, coaching: atCoaching, lessonsAll: atAll };
    }) },
];

module.exports = scenarios;
