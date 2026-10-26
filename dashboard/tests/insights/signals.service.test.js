'use strict';
/** NIGHTLY_JOB §4 stage 2 and FICO_CROSSWALK §2: one signal row per (fact, W) on the W's primary instrument, the
 * per-W hit rules as code, rule 2's denominator, and the coverage of every seeded primary. Fictional fixtures only. */
const F = require('./fixtures/analysis');
const X = require('./fixtures/rollups');
const library = require('../../data/coachip/INTERVENTIONS.json');
const crosswalk = require('../../data/coachip/crosswalk.json');
const S = require('../../lib/insights/signals');

const ctx = { weaknesses: library.weaknesses, crosswalk };
const byW = (rows) => Object.fromEntries(rows.map((r) => [r.w_id, r]));
const SIGNAL_COLUMNS = ['fact_id', 'session_id', 'w_id', 'source', 'is_in_denominator', 'is_hit', 'value', 'stamp_s', 'model_run_id', 'status'].sort();

describe('coverage: every seeded primary has an evaluator or is out of scope', () => {
  test('each primary crosswalk row of a seeded, non-S7 W is evaluated in code or written by another stage', () => {
    const seeded = new Set(library.weaknesses.map((w) => w.id));
    const primaries = crosswalk.rows.filter((r) => r.role === 'primary' && seeded.has(r.w_id));
    expect(primaries.length).toBeGreaterThan(20);
    for (const r of primaries) {
      const how = S.coverageOf(r.w_id, r.source);
      expect([`evaluator`, 'model_stage', 'result_cells']).toContain(how);
      if (r.source === 'coachip_detector') expect(how).toBe('model_stage');
      if (r.source === 'egra') expect(how).toBe('result_cells');
    }
  });

  test('each FICO evaluator reads the indicator id the crosswalk names, and its rule matches the crosswalk text', () => {
    const seeded = new Set(library.weaknesses.map((w) => w.id));
    for (const r of crosswalk.rows.filter((x) => x.role === 'primary' && seeded.has(x.w_id) && /^fico/.test(x.source))) {
      const ev = S.EVALUATORS[r.w_id][r.source];
      expect(ev.indicator).toBe(r.indicator_id);
      expect(ev.rule).toBe(r.hit_rule);
    }
  });

  test('no evaluator exists for a deferred or unseeded W', () => {
    const seeded = new Set(library.weaknesses.map((w) => w.id));
    for (const w of Object.keys(S.EVALUATORS)) expect(seeded.has(w)).toBe(true);
  });
});

describe('row shape and population', () => {
  const fact = X.lpFact([F.move('m1', 'explain', 'executed', { at: '02:10' }), F.move('m2', 'independent', 'not_done')]);

  test('rows carry exactly the coachip_session_signals columns, model_run_id null, status ok', () => {
    const rows = S.buildSignals(fact, ctx);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(SIGNAL_COLUMNS);
      expect(r.model_run_id).toBeNull();
      expect(r.status).toBe('ok');
      expect(r.fact_id).toBe(fact.id);
      expect(r.session_id).toBe(fact.session_id);
      if (r.is_hit) expect(r.is_in_denominator).toBe(true);
    }
  });

  test('an lp fact carries the fidelity Ws and the code W W-IP-HOME, never FICO, detector, egra or S7 Ws', () => {
    const rows = byW(S.buildSignals(fact, ctx));
    expect(Object.keys(rows).sort()).toEqual(['W-EXIT', 'W-EXIT-NOPLAN', 'W-EXIT-TIME', 'W-EXPLAIN', 'W-GP', 'W-GP-NOPLAN', 'W-GP-TIME',
      'W-IP', 'W-IP-HOME', 'W-IP-NOPLAN', 'W-IP-PARTIAL', 'W-IP-TIME', 'W-PEER', 'W-WARM'].sort());
    expect(rows['W-IP-HOME'].source).toBe('code');
    expect(rows['W-IP'].source).toBe('lp_fidelity');
  });

  test.each([
    ['duplicate', { duplicate: true }],
    ['mismatch', { note: 'lesson_mismatch' }],
    ['unusable', { unusable: true }],
    ['failed (no model)', { model: null }],
  ])('a %s fact gets no rows', (_, opts) => {
    const f = X.lpFact([F.move('m2', 'independent', 'not_done')], opts);
    expect(S.buildSignals(f, ctx)).toEqual([]);
  });

  test('a fact with no allowed data gets no rows rather than throwing', () => {
    expect(S.buildSignals({ ...fact, allowed: null }, ctx)).toEqual([]);
  });
});

describe('fidelity family: rule 2 denominator and the phase hits', () => {
  test('W-IP: skipped independent is a hit; done is in the denominator, not a hit; all not_adjudicable is outside', () => {
    const hit = byW(S.buildSignals(X.lpFact([F.move('m1', 'independent', 'not_done')]), ctx))['W-IP'];
    expect([hit.is_in_denominator, hit.is_hit]).toEqual([true, true]);
    const done = byW(S.buildSignals(X.lpFact([F.move('m1', 'independent', 'executed', { at: '12:00' })]), ctx))['W-IP'];
    expect([done.is_in_denominator, done.is_hit, done.stamp_s]).toEqual([true, false, 720]);
    const na = byW(S.buildSignals(X.lpFact([F.move('m1', 'independent', 'not_adjudicable')]), ctx))['W-IP'];
    expect([na.is_in_denominator, na.is_hit]).toEqual([false, false]);
  });

  test('an uncounted move never puts a lesson in the denominator', () => {
    const r = byW(S.buildSignals(X.lpFact([F.move('m1', 'independent', 'not_done', { counted: false })]), ctx))['W-IP'];
    expect(r.is_in_denominator).toBe(false);
  });

  test('W-IP-PARTIAL: not skipped and a counted partial; shares W-IP denominator', () => {
    const rows = byW(S.buildSignals(X.lpFact([F.move('m1', 'independent', 'partial', { at: '14:05' }), F.move('m2', 'independent', 'not_done')]), ctx));
    expect([rows['W-IP-PARTIAL'].is_in_denominator, rows['W-IP-PARTIAL'].is_hit, rows['W-IP-PARTIAL'].stamp_s]).toEqual([true, true, 845]);
    expect(rows['W-IP'].is_hit).toBe(false);
  });

  test('W-IP-TIME / W-IP-NOPLAN follow the cause split; a null split is in the denominator and not a hit', () => {
    const moves = [F.move('m1', 'independent', 'not_done'), F.move('m2', 'exit', 'not_done')];
    const ran = byW(S.buildSignals(X.lpFact(moves, { override: { is_ran_out_of_time: true, is_time_remained: false } }), ctx));
    expect([ran['W-IP-TIME'].is_hit, ran['W-IP-NOPLAN'].is_hit]).toEqual([true, false]);
    const rem = byW(S.buildSignals(X.lpFact(moves, { override: { is_ran_out_of_time: false, is_time_remained: true } }), ctx));
    expect([rem['W-IP-TIME'].is_hit, rem['W-IP-NOPLAN'].is_hit]).toEqual([false, true]);
    const unk = byW(S.buildSignals(X.lpFact(moves, { override: { is_ran_out_of_time: null, is_time_remained: null } }), ctx));
    for (const w of ['W-IP-TIME', 'W-IP-NOPLAN']) expect([unk[w].is_in_denominator, unk[w].is_hit]).toEqual([true, false]);
    expect(unk['W-IP'].is_hit).toBe(true);
  });

  test('W-IP-HOME: skipped independent and sent home, source code, W-IP denominator', () => {
    const moves = [F.move('m1', 'independent', 'not_done'), F.move('m2', 'homework', 'executed', { at: '10:00' })];
    const r = byW(S.buildSignals(X.lpFact(moves, { override: { is_sent_home: true } }), ctx))['W-IP-HOME'];
    expect([r.source, r.is_in_denominator, r.is_hit]).toEqual(['code', true, true]);
    const no = byW(S.buildSignals(X.lpFact(moves, { override: { is_sent_home: null } }), ctx))['W-IP-HOME'];
    expect([no.is_in_denominator, no.is_hit]).toEqual([true, false]);
  });

  test('W-GP-TIME and W-GP-NOPLAN', () => {
    const moves = [F.move('m1', 'guided', 'not_done'), F.move('m2', 'independent', 'not_done')];
    const t = byW(S.buildSignals(X.lpFact(moves, { override: { is_ran_out_of_time: true, is_time_remained: false } }), ctx));
    expect([t['W-GP'].is_hit, t['W-GP-TIME'].is_hit, t['W-GP-NOPLAN'].is_hit]).toEqual([true, true, false]);
    const n = byW(S.buildSignals(X.lpFact([F.move('m1', 'guided', 'not_done'), F.move('m2', 'exit', 'executed', { at: '20:00' })],
      { override: { is_ran_out_of_time: false, is_time_remained: true } }), ctx));
    expect([n['W-GP-TIME'].is_hit, n['W-GP-NOPLAN'].is_hit, n['W-GP-NOPLAN'].is_in_denominator]).toEqual([false, true, true]);
  });

  test('W-EXIT-TIME: skipped exit and (short of audio or a tail within 60 s)', () => {
    const moves = [F.move('m1', 'explain', 'executed', { at: '05:00' }), F.move('m2', 'exit', 'not_done')];
    const tail = byW(S.buildSignals(X.lpFact(moves, { audio_s: 1200, last_stamp_s: 1150 }), ctx))['W-EXIT-TIME'];
    expect(tail.is_hit).toBe(true);
    const short = byW(S.buildSignals(X.lpFact(moves, { audio_s: 1200, last_stamp_s: 600, short: true }), ctx))['W-EXIT-TIME'];
    expect(short.is_hit).toBe(true);
    const neither = byW(S.buildSignals(X.lpFact(moves, { audio_s: 1200, last_stamp_s: 600 }), ctx))['W-EXIT-TIME'];
    expect([neither.is_in_denominator, neither.is_hit]).toEqual([true, false]);
  });

  test('W-EXIT-NOPLAN: skipped exit and at least 120 s after the last done move', () => {
    const moves = (at) => [F.move('m1', 'explain', 'executed', { at }), F.move('m2', 'exit', 'not_done')];
    expect(byW(S.buildSignals(X.lpFact(moves('17:59'), { audio_s: 1200 }), ctx))['W-EXIT-NOPLAN'].is_hit).toBe(true); // 1200-1079=121
    expect(byW(S.buildSignals(X.lpFact(moves('18:30'), { audio_s: 1200 }), ctx))['W-EXIT-NOPLAN'].is_hit).toBe(false); // 90
    expect(byW(S.buildSignals(X.lpFact(moves('18:00'), { audio_s: 1200 }), ctx))['W-EXIT-NOPLAN'].is_hit).toBe(true); // exactly 120
  });

  test('W-WARM: skipped over the union of warm_up, hook and recall', () => {
    const all = byW(S.buildSignals(X.lpFact([F.move('m1', 'warm_up', 'not_done'), F.move('m2', 'hook', 'not_done')]), ctx))['W-WARM'];
    expect([all.is_in_denominator, all.is_hit]).toEqual([true, true]);
    const one = byW(S.buildSignals(X.lpFact([F.move('m1', 'warm_up', 'not_done'), F.move('m2', 'recall', 'executed', { at: '01:00' })]), ctx))['W-WARM'];
    expect([one.is_in_denominator, one.is_hit]).toEqual([true, false]);
    const none = byW(S.buildSignals(X.lpFact([F.move('m1', 'explain', 'executed', { at: '01:00' })]), ctx))['W-WARM'];
    expect(none.is_in_denominator).toBe(false);
  });

  test('W-PEER and W-EXPLAIN read their own phase', () => {
    const r = byW(S.buildSignals(X.lpFact([F.move('m1', 'peer_review', 'not_done'), F.move('m2', 'explain', 'partial', { at: '03:00' })]), ctx));
    expect([r['W-PEER'].is_hit, r['W-EXPLAIN'].is_in_denominator, r['W-EXPLAIN'].is_hit]).toEqual([true, true, false]);
  });
});

describe('FICO family', () => {
  test('v3: score <= 2 is a hit; value and the indicator timestamp are kept; only v3-primary Ws', () => {
    const f = X.ficoFact(F.v3({ C1: 2, C3: 3, D2: 1, B2: 4, B1: 2 }));
    expect(f.instrument).toBe('fico_v3');
    const rows = byW(S.buildSignals(f, ctx));
    expect(Object.keys(rows).sort()).toEqual(['W-FB', 'W-OBJ', 'W-Q', 'W-REASON', 'W-TRANS']);
    expect([rows['W-Q'].is_hit, rows['W-Q'].value, rows['W-Q'].stamp_s, rows['W-Q'].source]).toEqual([true, 2, 310, 'fico_v3']);
    expect(rows['W-FB'].is_hit).toBe(false);
    expect(rows['W-REASON'].is_hit).toBe(true);
    expect(rows['W-TRANS'].is_hit).toBe(false);
  });

  test('v3: applicable false or a missing score is outside the denominator', () => {
    const ad = F.v3({ C1: 1 });
    ad.domains.high_leverage_practices.indicators.find((i) => i.id === 'C1').applicable = false;
    ad.domains.high_leverage_practices.indicators.find((i) => i.id === 'C3').score = null;
    const rows = byW(S.buildSignals(X.ficoFact(ad), ctx));
    expect([rows['W-Q'].is_in_denominator, rows['W-Q'].is_hit]).toEqual([false, false]);
    expect(rows['W-FB'].is_in_denominator).toBe(false);
  });

  test('v4: score = 0 is a hit, 1 is not; W-PHON reads v4 F8 IN (0,1)', () => {
    const f = X.ficoFact(F.v4({ C1: 0, C3: 1, F8: 1 }));
    expect(f.instrument).toBe('fico_v4');
    const rows = byW(S.buildSignals(f, ctx));
    expect([rows['W-Q'].is_hit, rows['W-FB'].is_hit, rows['W-Q'].source]).toEqual([true, false, 'fico_v4']);
    expect(rows['W-PHON'].is_hit).toBe(true);
    expect(rows['W-PHON-NAMES']).toBeUndefined();
  });

  test('fico17: only W-GROUP (C7 level <= 2); never pooled into W-Q', () => {
    const f = X.ficoFact(F.fico17({ C7: 2, C1: 1 }));
    expect(f.instrument).toBe('fico17');
    const rows = S.buildSignals(f, ctx);
    expect(rows.map((r) => r.w_id)).toEqual(['W-GROUP']);
    expect([rows[0].is_hit, rows[0].source]).toEqual([true, 'fico17']);
  });

  test('a failed FICO fact (no instrument) gets no rows', () => {
    const f = X.ficoFact(F.generic());
    expect(f.status).toBe('failed');
    expect(S.buildSignals(f, ctx)).toEqual([]);
  });
});
