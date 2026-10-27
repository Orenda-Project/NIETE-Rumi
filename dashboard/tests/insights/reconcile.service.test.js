'use strict';
/** NIGHTLY_JOB §11 and §12 test 14: the B14 reconcile counts per phase on a hand-built fixture, with the governed
 * predicate of Q2b_last28d.sql (self-recordings, ICT, lp status ok, not unusable, not mismatch), dedup off and on. */
const F = require('./fixtures/analysis');
const X = require('./fixtures/rollups');
const { reconcile, PHASES } = require('../../lib/insights/reconcile');

const mv = F.move;
const facts = [
  /* f1 */ X.lpFact([mv('m1', 'independent', 'not_done'), mv('m2', 'exit', 'not_done')], { day: '2026-09-28' }),
  /* f2 */ X.lpFact([mv('m1', 'independent', 'executed', { at: '10:00' }), mv('m2', 'exit', 'partial', { at: '19:00' })], { day: '2026-10-25' }),
  /* f3 */ X.lpFact([mv('m1', 'independent', 'not_done'), mv('m2', 'independent', 'partial', { at: '12:00' }), mv('m3', 'warm_up', 'not_done')]),
  /* f4 */ X.lpFact([mv('m1', 'independent', 'not_adjudicable'), mv('m2', 'hook', 'not_done', { counted: false })]),
  /* f5 */ X.lpFact([mv('m1', 'independent', 'not_done'), mv('m2', 'guided', 'not_done')], { duplicate: true }),
  /* f6 */ X.lpFact([mv('m1', 'independent', 'not_done')], { observed: true }),
  /* f7 */ X.lpFact([mv('m1', 'independent', 'not_done')], { note: 'lesson_mismatch' }),
  /* f8 */ X.lpFact([mv('m1', 'independent', 'not_done')], { unusable: true }),
  /* f9 */ X.lpFact([mv('m1', 'independent', 'not_done')], { day: '2026-10-26' }),
  /* f10 */ X.lpFact([mv('m1', 'independent', 'not_done')], { override: { sector: null } }),
  /* f11 */ X.lpFact([mv('m1', 'independent', 'not_done')], { model: null }),
  /* f12 */ X.lpFact([mv('m1', 'independent', 'not_done'), mv('m2', 'independent', 'not_adjudicable'), mv('m3', 'explain', 'executed', { at: '04:00' })]),
  /* a FICO fact is never an lp lesson */ X.ficoFact(F.v3({})),
];
const asMap = (rows) => Object.fromEntries(rows.map((r) => [r.phase, [r.skipped, r.graded]]));
const window = { from: '2026-09-28', to: '2026-10-25' };

describe('reconcile (test 14)', () => {
  test('one row per phase, warm_up to homework, in plan order', () => {
    const rows = reconcile(facts, { ...window, dedup: false });
    expect(rows.map((r) => r.phase)).toEqual(PHASES);
    expect(PHASES).toEqual(['warm_up', 'hook', 'recall', 'announce', 'explain', 'guided', 'independent', 'peer_review', 'exit', 'homework']);
  });

  test('dedup off: the hand-counted [skipped, graded] per phase', () => {
    expect(asMap(reconcile(facts, { ...window, dedup: false }))).toEqual({
      warm_up: [1, 1], hook: [0, 0], recall: [0, 0], announce: [0, 0], explain: [0, 1], guided: [1, 1],
      independent: [3, 5], peer_review: [0, 0], exit: [1, 2], homework: [0, 0],
    });
  });

  test('dedup on drops the duplicate', () => {
    expect(asMap(reconcile(facts, { ...window, dedup: true }))).toEqual({
      warm_up: [1, 1], hook: [0, 0], recall: [0, 0], announce: [0, 0], explain: [0, 1], guided: [0, 0],
      independent: [2, 4], peer_review: [0, 0], exit: [1, 2], homework: [0, 0],
    });
  });

  test('the window is inclusive of both Karachi days and nothing else', () => {
    const rows = asMap(reconcile(facts, { from: '2026-10-25', to: '2026-10-25', dedup: false }));
    expect(rows.independent).toEqual([0, 1]);
    expect(rows.exit).toEqual([0, 1]);
  });

  test('a missing from/to throws rather than counting everything', () => {
    expect(() => reconcile(facts, { dedup: false })).toThrow();
  });
});
