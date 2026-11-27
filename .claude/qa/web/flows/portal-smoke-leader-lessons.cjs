// portal-smoke-leader-lessons — the hand-written portal-smoke LDR08 (bd-4joiqz): the leader family on the Lesson Plans
// pages. A principal with both app switches off, then a coach with the coach app v2 on, each open /portal/teacher/lessons
// and /portal/teacher/lessons/new, and each page must be HEALTHY (lib.visit: it settles where it was sent, no page error,
// no 5xx, no error screen, a heading). Joined to the generated portal-smoke driver by .claude/qa/web/gen_page_features.py
// (EXTRA), so spec and driver still come from one place.
'use strict';
const { asRole, visit } = require('../lib.cjs');

const PAGES = ['/portal/teacher/lessons', '/portal/teacher/lessons/new'];

module.exports = [{
  id: 'LDR08',
  title: 'Leader family: the Lesson Plans pages open healthy for a coach and a principal off the teacher app',
  run: async (page, ctx) => {
    const seen = {};
    for (const [role, mode] of [['principal', 'classic'], ['coach', 'coachV2']]) {
      // each leader in a fresh session: the second sign-in must not ride on the first one's cookie
      await page.context().clearCookies();
      await asRole(page, ctx, role, mode);
      seen[role] = [];
      for (const p of PAGES) seen[role].push(await visit(page, ctx, p, { heading: /\S/ }));
    }
    return seen;
  },
}];
