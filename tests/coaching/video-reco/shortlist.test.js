'use strict';
/**
 * bd-gzfdu9 — shortlist.build: the deterministic candidate clips (SPEC §3.3) and the ⛔ rows of the
 * pedagogy rubric as code filters (SPEC §4.8). No LLM, no I/O.
 */
const S = require('../../../bot/shared/services/coaching/video-reco/shortlist');
const C = require('../../../bot/shared/services/coaching/video-reco/catalog');

const cat = C.fromData(require('./fixtures/catalog.fixture.json'));
const tgt = (indicator, extra = {}) => ({ indicator, moves: [], alsoWeak: [], stepIndicator: indicator, ...extra });
const ctx = (extra = {}) => ({ language: 'ur', level: 2, history: [], ...extra });
const ids = (r) => r.candidates.map((c) => c.seg_id);
const G3 = { grade: 3 }; // a primary lesson: the 9-12 clip (module 18) is out

test('C1 for an Urdu level-2 teacher: only clips that pass every gate', () => {
  const r = S.build(cat, tgt('C1'), ctx(), 'the teacher asked yes no questions, why', G3);
  expect(r.noneReason).toBeNull();
  expect(new Set(ids(r))).toEqual(new Set(['10-s1', '10-s2', '11-s1']));
});

test('BM25 + the target bonus order the list, and the order is stable', () => {
  const r = S.build(cat, tgt('C1'), ctx(), 'why how open question yes no', {});
  expect(ids(r)[0]).toBe('10-s1');
  expect(ids(S.build(cat, tgt('C1'), ctx(), 'why how open question yes no', {}))).toEqual(ids(r));
  for (let i = 1; i < r.candidates.length; i++) expect(r.candidates[i - 1].score).toBeGreaterThanOrEqual(r.candidates[i].score);
});

test('every candidate names the indicator it was matched for', () => {
  const r = S.build(cat, tgt('C1', { alsoWeak: ['C2'] }), ctx(), 'explain again', {});
  expect(r.candidates.find((c) => c.seg_id === '11-s2').indicator).toBe('C2');
  expect(r.candidates.find((c) => c.seg_id === '10-s1').indicator).toBe('C1');
});

test('≥ 3 target-indicator clips survive the top-6 cut when ≥ 3 exist', () => {
  const r = S.build(cat, tgt('C1', { alsoWeak: ['C2', 'C3'] }), ctx({ level: 2 }), 'explain again picture feedback correct next exit', {});
  expect(r.candidates.length).toBeLessThanOrEqual(6);
  expect(r.candidates.filter((c) => c.indicator === 'C1').length).toBeGreaterThanOrEqual(3);
});

test('⛔3 wrong language: an English teacher never gets an Urdu-only clip; mixed suits both', () => {
  const r = S.build(cat, tgt('C1', { alsoWeak: ['C3'] }), ctx({ language: 'en' }), 'why', {});
  expect(ids(r)).toEqual(expect.arrayContaining(['12-s1', '14-s1']));
  expect(ids(r).some((id) => ['10-s1', '10-s2', '11-s1'].includes(id))).toBe(false);
});

test('⛔11 two rungs off: level ±1 only (a level-2 teacher never sees a level-4 clip)', () => {
  expect(ids(S.build(cat, tgt('C1'), ctx({ level: 2 }), 'why', {}))).not.toContain('13-s1');
  expect(ids(S.build(cat, tgt('C1'), ctx({ level: 3 }), 'why', {}))).toContain('13-s1');
});

test('unknown level reads as 2', () => {
  expect(ids(S.build(cat, tgt('C1'), ctx({ level: null }), 'why', {}))).not.toContain('13-s1');
});

test('⛔6 repeat: a module from the last 180 days is excluded', () => {
  expect(ids(S.build(cat, tgt('C1'), ctx({ history: [10] }), 'why', G3))).toEqual(['11-s1']);
});

test('⛔6 history empties the list → history modules once, repeatModule=true', () => {
  const r = S.build(cat, tgt('C1'), ctx({ history: [10, 11] }), 'why', G3);
  expect(r.repeatModule).toBe(true);
  expect(r.candidates.length).toBeGreaterThan(0);
  expect(r.noneReason).toBeNull();
});

test('⛔7 not a move: recommendable:false chapters and programme_intro modules are never candidates', () => {
  const r = S.build(cat, tgt('C1'), ctx(), 'why welcome course', {});
  expect(ids(r)).not.toContain('10-s3');
  expect(ids(r)).not.toContain('16-s1');
});

test('⛔12 broken media: quality.flags broken_media|no_speech excluded; media_ok:false excluded', () => {
  expect(ids(S.build(cat, tgt('C1'), ctx(), 'why', {}))).not.toContain('17-s1');
  const data = JSON.parse(JSON.stringify(require('./fixtures/catalog.fixture.json')));
  data.modules.find((m) => m.module_id === 10).media_ok = false;
  expect(ids(S.build(C.fromData(data), tgt('C1'), ctx(), 'why', G3))).toEqual(['11-s1']);
});

test('⛔5 wrong grade: a 9-12 clip for a grade-3 lesson is out; unknown grade keeps it', () => {
  expect(ids(S.build(cat, tgt('C1'), ctx(), 'why', { grade: 3 }))).not.toContain('18-s1');
  expect(ids(S.build(cat, tgt('C1'), ctx(), 'why', { grade: 10 }))).toContain('18-s1');
  expect(ids(S.build(cat, tgt('C1'), ctx(), 'why', {}))).toContain('18-s1');
});

describe('⛔4 content modules are gated by indicator AND topic', () => {
  test('a content module is never a candidate for a non-F target, even when it names the indicator', () => {
    expect(ids(S.build(cat, tgt('C1'), ctx(), 'fractions why', { subject: 'maths', topic: 'fractions' }))).not.toContain('15-s1');
  });
  test('F1 + a matching topic → candidate', () => {
    expect(ids(S.build(cat, tgt('F1'), ctx(), 'half', { subject: 'maths', topic: 'Fractions of a shape' }))).toEqual(['15-s1']);
  });
  test('F1 + another topic → not a candidate (hole)', () => {
    const r = S.build(cat, tgt('F1'), ctx(), 'half', { subject: 'maths', topic: 'Telling the time' });
    expect(r.candidates).toEqual([]);
    expect(r.noneReason).toBe('hole');
  });
  test('a subject-specific module is out for a lesson in another subject', () => {
    expect(ids(S.build(cat, tgt('F1'), ctx(), 'half', { subject: 'urdu', topic: 'fractions' }))).toEqual([]);
  });
});

test('a phase target matches by MOVE, not indicator', () => {
  const r = S.build(cat, { indicator: null, moves: ['activate_prior_knowledge', 'state_objective'], alsoWeak: [] }, ctx(), 'yesterday', {});
  expect(ids(r)).toEqual(['19-s1']);
});

describe('noneReason names the gate that emptied the list', () => {
  test('hole: no clip for the indicator at all', () => {
    expect(S.build(cat, tgt('F8'), ctx(), 'x', {}).noneReason).toBe('hole');
  });
  test('language', () => {
    expect(S.build(cat, tgt('B4'), ctx({ language: 'en' }), 'x', {}).noneReason).toBe('language');
  });
  test('level', () => {
    expect(S.build(cat, tgt('B4'), ctx({ level: 4 }), 'x', {}).noneReason).toBe('level');
  });
  test('no target indicator and no moves → hole', () => {
    expect(S.build(cat, { indicator: null, moves: [], alsoWeak: [] }, ctx(), 'x', {}).noneReason).toBe('hole');
  });
});

test('Urdu signal text is tokenised (Arabic-script tokens kept)', () => {
  expect(S.tokens('بچوں سے سوال پوچھیں why?')).toEqual(['بچوں', 'سے', 'سوال', 'پوچھیں', 'why']);
});

test('never throws on junk', () => {
  expect(S.build(C.fromData(null), tgt('C1'), ctx(), null, null)).toEqual({ candidates: [], noneReason: 'hole', repeatModule: false });
  expect(S.build(cat, null, null, null, null).noneReason).toBe('hole');
});
