'use strict';
/**
 * bd-wpw633 — "Lesson plans used" (schools-analytics v8, the RDF's lp_use) counts a K-5 plan opened in the app the
 * same way whichever lane the app read it from.
 *
 * A curriculum's Grade 1-5 books on the segment lane (GB's NBF Grades 1-5, v10) are K-5 lessons, but the app records
 * most of their opens as plan_kind 'g612' (prod 9-17 Nov: 98 of 99 nbf_snc Grade 1-5 opens). The app CTE took
 * plan_kind 'k5' only, so such an open was no plan used. It now takes a 'g612' open whose segment is Grade 1-5 too:
 * the Grade 1-5 test lp-engagement's Primary already applies to the same segments (one K5_GRADES).
 *
 * ICT cannot move: ICT's segments are all Grades 6-12 (prod 18 Nov: 0 segments of Grade 1-5 outside nbf_snc), and a
 * 'g612' open that does not name a Grade 1-5 segment (an ICT segment, or one of the ~400 ICT 'g612' opens carrying a
 * K-5 catalogue id) still counts nothing here, as the RDF's lp_use counts nothing for it.
 */

const Schools = require('../../dashboard/services/schools-analytics.service');
const LpEngagement = require('../../dashboard/services/lp-engagement.service');

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LISTS = {
  fdeSchoolEmis: new Set(['101']),
  primary: new Map([[U(1), 'B.K']]),
  midHigh: new Map([[U(2), 'Sihala']]),
  sectorByUser: null,
  coaches: null,
  asOf: { schools: '2026-10-19', teachers: '2026-10-19', coaches: null },
  missing: { schools: false, teachers: false, coaches: false },
};

async function teachersRead() {
  const sql = [];
  const query = async (q, p) => { sql.push({ q, p }); return { rows: [] }; };
  await Schools.loadSchoolsAnalyticsRows(query, { from: '2026-11-01', to: '2026-11-18' }, { lists: LISTS, memo: Schools.createScoreMemo() });
  return sql.find((s) => /FROM lesson_plans/.test(s.q));
}

/** The app CTE alone: from `app AS` to the CTE after it. */
const appCte = (q) => q.slice(q.indexOf('app AS'), q.indexOf('lp AS'));

describe('schools-analytics v8 — a K-5 app open, either lane (bd-wpw633)', () => {
  it("counts a 'g612' open of a Grade 1-5 segment as a K-5 plan opened in the app", async () => {
    const app = appCte((await teachersRead()).q);
    expect(app).toMatch(/plan_kind = 'g612'/);
    expect(app).toMatch(/niete_lp612_segments/);
    expect(app).toMatch(/grade BETWEEN 1 AND 5/);
  });

  it("still counts every 'k5' open, and no 'g612' open that is not of a Grade 1-5 segment (ICT unchanged)", async () => {
    const app = appCte((await teachersRead()).q);
    expect(app).toMatch(/plan_kind = 'k5'/);
    // the 'g612' branch is bound to the Grade 1-5 segment test: no bare "OR plan_kind = 'g612'" that takes every open
    expect(app).toMatch(/plan_kind = 'g612' AND EXISTS \(\s*SELECT 1 FROM niete_lp612_segments/);
    expect(app).not.toMatch(/plan_kind IN \(/);
  });

  it('dedupes a plan opened both ways on one day: still a UNION on (teacher, day, plan)', async () => {
    const app = appCte((await teachersRead()).q);
    expect(app).toMatch(/\bUNION\b(?! ALL)/);
  });

  it('one Grade 1-5 band: lp-engagement Primary and this rule read the same K5_GRADES', () => {
    expect(Schools.K5_GRADES).toEqual([1, 5]);
    expect(LpEngagement.BAND_RULES.primary.grades).toBe(Schools.K5_GRADES);
  });
});
