'use strict';
/**
 * Fictional in-memory facts for the moments, legs, clips and results tests (w-moments). Built through the real
 * allow-list reader and fact builder, so the tests run the same path the job does. No real names or ids.
 */
const F = require('./analysis');
const { readAllowed } = require('../../../lib/insights/allowlist');
const { buildLpFact, buildFicoFact } = require('../../../lib/insights/facts');

let seq = 0;
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** An lp fact from fixture moves; opts go to F.lp, plus {id, session_id, teacher_key, recorded_at}. */
function lpFact(moves, opts = {}) {
  seq += 1;
  const sid = opts.session_id || uuid(1000 + seq);
  const allowed = readAllowed({ lp_fidelity: F.lp(moves, opts) });
  const fact = buildLpFact({ id: sid }, allowed);
  return {
    ...fact,
    id: opts.id || uuid(5000 + seq),
    instrument: 'lp_fidelity',
    is_duplicate: false,
    teacher_key: opts.teacher_key || 'a1b2c3d4e5f60718',
    recorded_at: opts.recorded_at || '2026-10-20T05:00:00.000Z',
    allowed,
  };
}

/** A FICO fact (v3 or v4 fixture analysis). */
function ficoFact(analysis, opts = {}) {
  seq += 1;
  const sid = opts.session_id || uuid(1000 + seq);
  const allowed = readAllowed(analysis);
  const fact = buildFicoFact({ id: sid }, allowed);
  return {
    ...fact,
    id: opts.id || uuid(5000 + seq),
    is_duplicate: false,
    audio_s: opts.audio_s != null ? opts.audio_s : 1200,
    teacher_key: opts.teacher_key || 'a1b2c3d4e5f60718',
    recorded_at: opts.recorded_at || '2026-10-20T05:00:00.000Z',
    allowed,
  };
}

/** A coachip_session_signals row for a fact. */
function signal(fact, wId, hit, extra = {}) {
  return {
    fact_id: fact.id, session_id: fact.session_id, w_id: wId, source: extra.source || 'lp_fidelity',
    is_in_denominator: extra.in_denominator !== undefined ? extra.in_denominator : true, is_hit: hit,
    value: extra.value != null ? extra.value : null, stamp_s: extra.stamp_s != null ? extra.stamp_s : null, status: 'ok',
  };
}

module.exports = { lpFact, ficoFact, signal, uuid };
