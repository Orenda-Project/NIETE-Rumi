'use strict';
/**
 * bd-s0ccn5.2.2 — which FLN plans get a PDF, and where each one lives in the bucket. Pure: reads a corpus bundle
 * (dashboard/services/fln-corpus.service.js shape), touches nothing.
 *
 * Served = a placement row on the core or additional shelf whose plan is in the bundle (same rule as the service).
 * A plan placed in several grades gets ONE PDF, labelled from its first row in bundle order. Counts follow the
 * service: an explicit row.count wins, else the served rows with pos > 0 in the same (subject, grade, strand).
 */

const SERVED = new Set(['core', 'additional']);
const VER_RX = /^[A-Za-z0-9._-]{1,64}$/;
const ID_RX = /^\d{1,9}$/;

function pdfKey(version, id) {
  const v = String(version || '');
  const i = String(id);
  if (!VER_RX.test(v) || v.includes('..')) throw new Error(`bad corpus version: ${v}`);
  if (!ID_RX.test(i)) throw new Error(`bad plan id: ${i}`);
  return `fln/pdf/${v}/${i}.pdf`;
}

const strandKey = (r) => `${r.subject}|${r.grade}|${r.strand}`;
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

function planJobs(bundle) {
  if (!bundle || typeof bundle !== 'object') return [];
  const plans = bundle.plans || {};
  const rows = (bundle.placement || []).filter((r) => r && SERVED.has(r.shelf) && plans[String(r.lp_id)]);
  const counted = new Map();
  for (const r of rows) if (Number(r.pos) > 0) counted.set(strandKey(r), (counted.get(strandKey(r)) || 0) + 1);
  const seen = new Set();
  const jobs = [];
  for (const r of rows) {
    const id = String(r.lp_id);
    if (seen.has(id)) continue;
    seen.add(id);
    jobs.push({
      id,
      plan: plans[id],
      placement: { level: r.level, pos: Number(r.pos) || 0, count: isNum(r.count) ? r.count : counted.get(strandKey(r)) || 0 },
    });
  }
  return jobs;
}

module.exports = { planJobs, pdfKey };
