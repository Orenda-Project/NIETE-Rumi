'use strict';
/** NIGHTLY_JOB §3, §4 stage 1, §12 tests 3-7: the allow-list reader, the stamp regex, the predicates, the instrument
 * detection, population flags, de-duplication and the cause split. Fixtures are fictional (fixtures/analysis.js). */
const F = require('./fixtures/analysis');
const { readAllowed, stampOf, clockToSeconds } = require('../../lib/insights/allowlist');
const P = require('../../lib/insights/predicates');
const facts = require('../../lib/insights/facts');

describe('allow-list reader (test 3)', () => {
  const lpData = F.lp([F.move('m1', 'explain', 'executed', { at: '02:10' }), F.move('m2', 'independent', 'not_done')]);

  test('a Proxy over analysis_data throws on any forbidden key; the reader never trips it (prod v3 shape)', () => {
    const ad = F.trap(F.withForbidden({ lp_fidelity: lpData, ...F.v3({ C1: 2 }) }));
    expect(() => ad.executive_summary).toThrow(/forbidden/);
    expect(() => readAllowed(ad)).not.toThrow();
  });

  test('the reader runs clean on a sandbox v4 shape and a fico17 shape', () => {
    expect(() => readAllowed(F.trap(F.withForbidden({ lp_fidelity: lpData, ...F.v4({}) })))).not.toThrow();
    expect(() => readAllowed(F.trap(F.withForbidden({ lp_fidelity: lpData, ...F.fico17({}) })))).not.toThrow();
  });

  test('the output carries no evidence text, no forbidden key and no evidence_summary', () => {
    const out = readAllowed(F.withForbidden({ lp_fidelity: lpData, ...F.v3({}) }));
    const s = JSON.stringify(out);
    expect(s).not.toMatch(/placeholder quote/);
    expect(s).not.toMatch(/evidence_summary|executive_summary|named_student|teacher_name|focus_area/);
    expect(out.lp.moves[0].stampS).toBe(130);
    expect(out.gloss.moves.m1.evidenceTranslation).toBe('placeholder translation');
    expect(out.gloss.moves.m1).not.toHaveProperty('evidence');
  });

  test('missing analysis returns nulls, never throws', () => {
    expect(readAllowed(null)).toEqual({ lp: null, fico: null, gloss: { narrative: null, moves: {} } });
  });
});

describe('stamp regex (test 4)', () => {
  test.each([
    ['[02:35] text', 155], ['[00:00]', 0], ['[75:05] long lesson', 4505], ['[123:59] x', 7439],
    ['', null], ['02:35 no bracket', null], ['[2:61] bad seconds', null], ['[1234:00] too long', null], [null, null],
  ])('%p → %p', (input, out) => { expect(stampOf(input)).toBe(out); });

  test('clockToSeconds parses MM:SS with minutes past 59', () => {
    expect(clockToSeconds('15:43')).toBe(943);
    expect(clockToSeconds('75:00')).toBe(4500);
    expect(clockToSeconds('x')).toBe(null);
  });
});

describe('skipped() and done() (test 5, FICO_CROSSWALK rule 2)', () => {
  const m = (phase, verdict, counted = true) => ({ phase, verdict, counted });
  test('all not_adjudicable → outside the denominator', () => {
    const o = P.phaseOutcome([m('exit', 'not_adjudicable'), m('exit', 'not_adjudicable')], 'exit');
    expect(o).toEqual({ graded: false, skipped: false, done: false, full: false, partial: false });
  });
  test('one not_done plus one not_adjudicable → skipped', () => {
    const o = P.phaseOutcome([m('exit', 'not_done'), m('exit', 'not_adjudicable')], 'exit');
    expect(o.graded).toBe(true);
    expect(o.skipped).toBe(true);
  });
  test('a partial is graded, not skipped, not done', () => {
    const o = P.phaseOutcome([m('independent', 'partial'), m('independent', 'not_done')], 'independent');
    expect(o).toMatchObject({ graded: true, skipped: false, done: false, partial: true });
  });
  test('uncounted moves are ignored', () => {
    expect(P.phaseOutcome([m('independent', 'not_done', false)], 'independent').graded).toBe(false);
  });
  test('substituted_better is done; full = every counted move done', () => {
    const o = P.phaseOutcome([m('guided', 'substituted_better'), m('guided', 'executed')], 'guided');
    expect(o).toMatchObject({ graded: true, skipped: false, done: true, full: true });
  });
  test('a union of phases (W-WARM)', () => {
    const o = P.phaseOutcome([m('warm_up', 'not_done'), m('recall', 'not_done')], ['warm_up', 'hook', 'recall']);
    expect(o.skipped).toBe(true);
  });
});

describe('instrument detection (test 6)', () => {
  const det = (ad) => facts.detectFicoInstrument(readAllowed(ad).fico);
  test('v3 (prod: carries indicators_applicable too)', () => { expect(det(F.v3({}))).toBe('fico_v3'); });
  test('v4 (sandbox: version string says 3.0, shape says v4)', () => { expect(det(F.v4({}))).toBe('fico_v4'); });
  test('v2', () => { expect(det(F.v2({}))).toBe('fico_v2'); });
  test('fico17 is checked first', () => { expect(det(F.fico17({}))).toBe('fico17'); });
  test('v1', () => {
    const ad = F.v2({});
    ad.domains.high_leverage_practices.domain_max = 16;
    ad.domains.teacher_subject_knowledge.domain_max = 12;
    expect(det(ad)).toBe('fico_v1');
  });
  test('the generic five-domain rubric matches none', () => { expect(det(F.generic())).toBe(null); });
});

describe('the lp_fidelity fact: population flags and status', () => {
  const base = { id: 's1', observation_type: null, has_lesson_plan: true };
  const build = (lpData) => facts.buildLpFact(base, readAllowed({ lp_fidelity: lpData }));

  test('ok', () => {
    const f = build(F.lp([F.move('m1', 'independent', 'executed', { at: '10:00' })]));
    expect(f).toMatchObject({ status: 'ok', failure_class: null, is_mismatch: false, is_unusable: false, is_lp_linked: true,
      grader_model: 'google/gemini-3.8-flash', framework_version: 'lp_fidelity' });
  });
  test('lesson_mismatch → status mismatch', () => {
    expect(build(F.lp([], { note: 'lesson_mismatch' }))).toMatchObject({ status: 'mismatch', is_mismatch: true });
  });
  test('recording_unusable true → is_unusable; a missing key is false', () => {
    expect(build(F.lp([], { unusable: true })).is_unusable).toBe(true);
    const d = F.lp([]);
    delete d.recording_unusable;
    expect(build(d).is_unusable).toBe(false);
  });
  test('ok without a model → failed input_missing (the one prod row)', () => {
    expect(build(F.lp([], { model: null }))).toMatchObject({ status: 'failed', failure_class: 'input_missing' });
  });
  test('lp_absent → no lp fact', () => {
    expect(build(F.lp([], { status: 'lp_absent' }))).toBe(null);
  });
  test('grade and subject; lesson_type', () => {
    const f = build(F.lp([], { grade: '2', subject: 'urdu' }));
    expect(f).toMatchObject({ grade: 2, subject: 'urdu', lesson_type: 'literacy_phonics' });
    expect(build(F.lp([], { grade: '5', subject: 'english' })).lesson_type).toBe('literacy_text');
    expect(build(F.lp([], { grade: '5', subject: 'maths' })).lesson_type).toBe('maths');
    expect(build(F.lp([], { grade: '5', subject: 'islamiat' })).lesson_type).toBe('other');
  });
  test('a grade outside 1-12 is stored null, never a crash', () => {
    expect(build(F.lp([], { grade: 'KG' })).grade).toBe(null);
  });
  test('the input hash is stable and changes when an allow-listed field changes', () => {
    const a = build(F.lp([F.move('m1', 'independent', 'not_done')]));
    const b = build(F.lp([F.move('m1', 'independent', 'not_done')]));
    const c = build(F.lp([F.move('m1', 'independent', 'executed')]));
    expect(a.input_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.input_hash).toBe(b.input_hash);
    expect(a.input_hash).not.toBe(c.input_hash);
  });
});

describe('the cause split (test 7: truth table)', () => {
  const split = (lpData) => facts.causeSplit(readAllowed({ lp_fidelity: lpData }).lp);
  const ipSkipped = (extra = [], exitVerdict = 'not_done', tot = { prescribed_minutes: 5 }) => [
    F.move('m1', 'explain', 'executed', { at: '05:00' }),
    F.move('m2', 'guided', 'executed', { at: '12:00' }),
    F.move('m3', 'independent', 'not_done', { tot }),
    F.move('m4', 'exit', exitVerdict, exitVerdict === 'executed' ? { at: '19:00' } : {}),
    ...extra,
  ];

  test('last_done_s = largest stamp of an executed, substituted or partial move', () => {
    expect(split(F.lp(ipSkipped())).last_done_s).toBe(720);
  });
  test('ran out: exit skipped and the recording ends within 60 s of the last stamp', () => {
    const r = split(F.lp(ipSkipped(), { audio_s: 1200, last_stamp_s: 1170 }));
    expect(r).toMatchObject({ is_ran_out_of_time: true, is_time_remained: false });
  });
  test('ran out: short of audio', () => {
    expect(split(F.lp(ipSkipped(), { audio_s: 1200, last_stamp_s: 900, short: true })).is_ran_out_of_time).toBe(true);
  });
  test('ran out: less than the prescribed practice left after the last done move', () => {
    // audio 1000 - last_done 720 = 280 < 5 min x 60 = 300
    expect(split(F.lp(ipSkipped(), { audio_s: 1000, last_stamp_s: 800 })).is_ran_out_of_time).toBe(true);
  });
  test('time remained: exit skipped but every leg says there was time', () => {
    // audio 1500 - last_stamp 1200 = 300 > 60; 1500 - 720 = 780 >= 300
    expect(split(F.lp(ipSkipped(), { audio_s: 1500, last_stamp_s: 1200 }))).toMatchObject({ is_ran_out_of_time: false, is_time_remained: true });
  });
  test('exit done → time remained', () => {
    expect(split(F.lp(ipSkipped([], 'executed'), { audio_s: 1200, last_stamp_s: 1190 })).is_time_remained).toBe(true);
  });
  test('no leg can be evaluated → both null', () => {
    const d = F.lp(ipSkipped([], 'not_done', {}), { audio_s: 1200, last_stamp_s: 1190 });
    delete d.recording.audio_s;
    delete d.recording.transcript_short_of_audio;
    expect(split(d)).toMatchObject({ is_ran_out_of_time: null, is_time_remained: null });
  });
  test('sent home: IP skipped, homework done before ends_at minus the practice time', () => {
    const d = F.lp(ipSkipped([F.move('m5', 'homework', 'executed', { at: '13:00' })]), { ends_at: '20:00' });
    expect(split(d).is_sent_home).toBe(true); // 780 <= 1200 - 300
  });
  test('not sent home: homework at the very end', () => {
    const d = F.lp(ipSkipped([F.move('m5', 'homework', 'executed', { at: '19:30' })]), { ends_at: '20:00' });
    expect(split(d).is_sent_home).toBe(false);
  });
  test('sent home is null without a prescribed practice time', () => {
    const d = F.lp(ipSkipped([F.move('m5', 'homework', 'executed', { at: '13:00' })], 'not_done', {}));
    expect(split(d).is_sent_home).toBe(null);
  });
});

describe('de-duplication on audio_hash', () => {
  test('keeps the coach visit first, then the earliest; others name the kept session', () => {
    const rows = [
      { id: 'a', audio_hash: 'h1', observation_type: null, created_at: '2026-10-01T05:00:00Z', user_id: 't1', audio_duration_seconds: 900 },
      { id: 'b', audio_hash: 'h1', observation_type: 'leader_observation', created_at: '2026-10-01T06:00:00Z', user_id: 't1', audio_duration_seconds: 900 },
      { id: 'c', audio_hash: 'h1', observation_type: null, created_at: '2026-10-01T04:00:00Z', user_id: 't1', audio_duration_seconds: 900 },
      { id: 'd', audio_hash: 'h2', observation_type: null, created_at: '2026-10-02T04:00:00Z', user_id: 't1', audio_duration_seconds: 900 },
    ];
    const dup = facts.dedupe(rows);
    expect(dup.get('a')).toBe('b');
    expect(dup.get('c')).toBe('b');
    expect(dup.has('b')).toBe(false);
    expect(dup.has('d')).toBe(false);
  });
  test('no hash: same teacher, same Karachi day, durations within 1 s', () => {
    const rows = [
      { id: 'a', audio_hash: null, observation_type: null, created_at: '2026-08-01T20:00:00Z', user_id: 't1', audio_duration_seconds: 900.4 },
      { id: 'b', audio_hash: null, observation_type: null, created_at: '2026-08-01T21:00:00Z', user_id: 't1', audio_duration_seconds: 901.0 },
      { id: 'c', audio_hash: null, observation_type: null, created_at: '2026-08-01T18:00:00Z', user_id: 't1', audio_duration_seconds: 900.0 },
    ];
    // 20:00Z and 21:00Z are 2 Aug in Karachi (UTC+5); 18:00Z is 1 Aug 23:00 PKT: a different day.
    const dup = facts.dedupe(rows);
    expect(dup.get('b')).toBe('a');
    expect(dup.has('c')).toBe(false);
  });
});
