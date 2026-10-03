'use strict';

/**
 * Which card set a cycle reads (CONTRACT §19, design §2): one set per grade per term, no choice on
 * the day. Sets alternate by cycle — A, B, A, … — counted from ICT-2026-Q4, whose set is
 * CHILD_TEST_TERM_SET_BASE (default A).
 *
 * CHILD_TEST_FORM_POLICY: 'term' (default, v2) or 'returning_b' (v1: new children Form A, the
 * returning child Form B). Read straight from process.env on every call, so the switch needs no deploy.
 */

const ANCHOR = { year: 2026, quarter: 4 };
const POLICIES = ['term', 'returning_b'];

function formPolicy() {
  const p = String(process.env.CHILD_TEST_FORM_POLICY || '').trim().toLowerCase();
  return POLICIES.includes(p) ? p : 'term';
}

/** 'ICT-2027-Q1' → 'B' (with the default base). An unreadable cycle id reads the base set. */
function termSet(cycleId) {
  const base = String(process.env.CHILD_TEST_TERM_SET_BASE || 'A').trim().toUpperCase() === 'B' ? 'B' : 'A';
  const other = base === 'A' ? 'B' : 'A';
  const m = /-(\d{4})-Q([1-4])$/.exec(String(cycleId || ''));
  if (!m) return base;
  const steps = (Number(m[1]) * 4 + Number(m[2])) - (ANCHOR.year * 4 + ANCHOR.quarter);
  return Math.abs(steps) % 2 === 0 ? base : other;
}

module.exports = { formPolicy, termSet, POLICIES };
