'use strict';
/**
 * bd-gzfdu9 — shortlist.build: the deterministic candidate chapters (SPEC v1.3 §3.3; the v1.3 rules: retrieval-v13.test.js) with the pedagogy rubric's
 * ⛔ rows as code. No LLM, no I/O.
 */
const S = require('../../../bot/shared/services/coaching/video-reco/shortlist');
const C = require('../../../bot/shared/services/coaching/video-reco/catalog');

const FIX = require('./fixtures/catalog.fixture.json');
const cat = C.fromData(FIX);
const copy = (fn) => { const d = JSON.parse(JSON.stringify(FIX)); fn(d); return C.fromData(d); };
const seg = (d, id) => d.modules.flatMap((m) => m.segments).find((s) => s.seg_id === id);
const mod = (d, id) => d.modules.find((m) => m.module_id === id);

const tgt = (indicator, extra = {}) => ({ indicator, indicators: [indicator], moves: [], native37: false, source: 'step', ...extra });
const ctx = (extra = {}) => ({ language: 'ur', languages: ['ur', 'mixed'], level: 2, ladderComplete: false, history: { segments: [], modules: [] }, ...extra });
const L = (extra = {}) => ({ subject: 'urdu', grade: { lo: 3, hi: 3 }, topic: null, inapplicable: [], ...extra });
const ids = (r) => r.candidates.map((c) => c.seg_id);
const set = (r) => new Set(ids(r));

test('C1 for an Urdu-reading, Urdu-taught level-2 teacher, grade-3 Urdu lesson: only what passes every gate', () => {
  const r = S.build(cat, tgt('C1'), ctx(), 'yes no why', L());
  expect(r.noneReason).toBeNull();
  expect(set(r)).toEqual(new Set(['10-s1', '10-s2', '11-s1', '13-s1'])); // 13-s1 is level 4: listed since v1.3 R1 (far)
  expect(r.candidates.every((c) => c.indicator === 'C1')).toBe(true);
});

test('only step-indicator chapters: alsoWeak is gone', () => {
  expect(ids(S.build(cat, tgt('C1'), ctx(), 'explain again picture', L()))).not.toContain('11-s2');
});

test('BM25 + bonuses order the list, stable, best first', () => {
  const r = S.build(cat, tgt('C1'), ctx(), 'why how open question yes no', L());
  expect(ids(r)[0]).toBe('10-s1');
  expect(ids(S.build(cat, tgt('C1'), ctx(), 'why how open question yes no', L()))).toEqual(ids(r));
  for (let i = 1; i < r.candidates.length; i++) expect(r.candidates[i - 1].score).toBeGreaterThanOrEqual(r.candidates[i].score);
});

describe('⛔3 language (H1): preferred ∪ transcript ∪ mixed, chapter language first', () => {
  test('an English-reading teacher who teaches in Urdu still gets Urdu chapters, matched as transcript', () => {
    const r = S.build(cat, tgt('C1'), ctx({ language: 'en', languages: ['en', 'ur', 'mixed'] }), 'why', L());
    const by = Object.fromEntries(r.candidates.map((c) => [c.seg_id, c.language_match]));
    expect(by['10-s1']).toBe('transcript');
    expect(by['12-s1']).toBe('preferred');
    expect(by['21-s1']).toBe('preferred');
  });
  test('the chapter\'s own language beats the module\'s (module 21 is mixed, its chapter is English)', () => {
    expect(ids(S.build(cat, tgt('C1'), ctx(), 'why', L()))).not.toContain('21-s1');
  });
  test('preferred language ranks above the transcript language at equal text', () => {
    const r = S.build(cat, tgt('C1'), ctx({ language: 'en', languages: ['en', 'ur', 'mixed'] }), 'why question', L());
    expect(ids(r).indexOf('12-s1')).toBeLessThan(ids(r).indexOf('10-s1'));
  });
});

describe('⛔11 level (H2) — a preference since SPEC v1.3 R1 (the flips: retrieval-v13.test.js)', () => {
  test('known level: every rung listed, ±1 is near, further is far', () => {
    const r = S.build(cat, tgt('C1'), ctx({ level: 2 }), 'why', L());
    expect(ids(r)).toContain('13-s1');
    expect(r.candidates.find((c) => c.seg_id === '13-s1').level_match).toBe('far');
    expect(r.levelMatch).toBeNull();
  });
  test('two rungs away is listed as far (no widening step any more)', () => {
    const r = S.build(cat, tgt('B4'), ctx({ level: 4 }), 'recall', L());
    expect(ids(r)).toEqual(['19-s1']);
    expect(r.candidates[0].level_match).toBe('far');
  });
  test('unknown level: no filter, but level 4 only when nothing else exists', () => {
    const r = S.build(cat, tgt('C1'), ctx({ level: null }), 'why', L());
    expect(ids(r)).toEqual(expect.arrayContaining(['10-s1', '11-s1']));
    expect(ids(r)).not.toContain('13-s1');
    expect(r.levelMatch).toBe('unknown');
  });
  test('the whole ladder completed → every level open', () => {
    const r = S.build(cat, tgt('C1'), ctx({ level: 4, ladderComplete: true }), 'why', L());
    expect(ids(r)).toEqual(expect.arrayContaining(['10-s1', '13-s1']));
    expect(r.levelMatch).toBe('completed');
  });
});

describe('⛔6 history (H16, reversed for the ladder)', () => {
  test('a chapter already recommended never comes back', () => {
    expect(ids(S.build(cat, tgt('C1'), ctx({ history: { segments: ['10-s1'], modules: [] } }), 'why', L()))).not.toContain('10-s1');
  });
  test('a module with ≥ 2 recommended chapters is out', () => {
    expect(set(S.build(cat, tgt('C1'), ctx({ history: { segments: [], modules: [10] } }), 'why', L()))).toEqual(new Set(['11-s1', '13-s1']));
  });
  test('emptied by module history → those modules once (repeat_module), never a repeated chapter', () => {
    const r = S.build(cat, tgt('C1'), ctx({ history: { segments: ['10-s1'], modules: [10, 11, 13] } }), 'why', L());
    expect(r.repeatModule).toBe(true);
    expect(set(r)).toEqual(new Set(['10-s2', '11-s1', '13-s1']));
  });
  test('every chapter already seen → none:history', () => {
    expect(S.build(cat, tgt('C1'), ctx({ history: { segments: ['10-s1', '10-s2', '11-s1', '13-s1'], modules: [] } }), 'why', L()).noneReason).toBe('history');
  });
});

describe('⛔4 subject (H6)', () => {
  test('known subject: a maths-only module is out of an Urdu lesson, in for a maths lesson', () => {
    expect(ids(S.build(cat, tgt('C1'), ctx(), 'why', L()))).not.toContain('22-s1');
    expect(ids(S.build(cat, tgt('C1'), ctx(), 'why', L({ subject: 'maths' })))).toContain('22-s1');
  });
  test('unknown subject: single-subject modules are out', () => {
    expect(ids(S.build(cat, tgt('C1'), ctx(), 'why', L({ subject: null })))).not.toContain('22-s1');
  });
  test('a literacy module suits an Urdu or English lesson', () => {
    const c = copy((d) => { mod(d, 10).subjects = ['literacy']; });
    expect(ids(S.build(c, tgt('C1'), ctx(), 'why', L({ subject: 'urdu' })))).toContain('10-s1');
    expect(ids(S.build(c, tgt('C1'), ctx(), 'why', L({ subject: 'maths' })))).not.toContain('10-s1');
  });
  test('not_for naming the lesson\'s subject excludes the module', () => {
    const c = copy((d) => { mod(d, 10).not_for = 'Not for maths lessons'; });
    expect(ids(S.build(c, tgt('C1'), ctx(), 'why', L({ subject: 'maths' })))).not.toContain('10-s1');
  });
  test('content modules only for F1–F3 with a matching topic', () => {
    expect(ids(S.build(cat, tgt('C1'), ctx(), 'fractions', L({ subject: 'maths', topic: 'fractions' })))).not.toContain('15-s1');
    expect(ids(S.build(cat, tgt('F1'), ctx(), 'half', L({ subject: 'maths', topic: 'Fractions of a shape' })))).toEqual(['15-s1']);
    expect(S.build(cat, tgt('F1'), ctx(), 'half', L({ subject: 'maths', topic: 'Telling the time' })).noneReason).toBe('hole');
  });
  test('card_text: a chapter whose fico is only F4–F10 rows not applicable in this lesson is out', () => {
    const c = copy((d) => { seg(d, '22-s1').fico = [{ indicator: 'F4', strength: 2 }]; });
    const t = { indicator: null, indicators: [], moves: [], source: 'card_text', cardText: 'reasoning know' };
    expect(ids(S.build(c, t, ctx(), 'how do you know reasoning', L({ subject: 'maths', inapplicable: ['F4'] })))).not.toContain('22-s1');
    expect(ids(S.build(c, t, ctx(), 'how do you know reasoning', L({ subject: 'maths', inapplicable: [] })))).toContain('22-s1');
  });
});

describe('⛔5 grade (H7)', () => {
  test('a narrow band needs a known grade that intersects it', () => {
    expect(ids(S.build(cat, tgt('C1'), ctx(), 'why', L({ grade: null })))).not.toContain('18-s1');
    expect(ids(S.build(cat, tgt('C1'), ctx(), 'why', L({ grade: { lo: 3, hi: 3 } })))).not.toContain('18-s1');
    expect(ids(S.build(cat, tgt('C1'), ctx(), 'why', L({ grade: { lo: 6, hi: 12 } })))).toContain('18-s1');
  });
  test('all / primary pass when the grade is unknown', () => {
    expect(ids(S.build(cat, tgt('C1'), ctx(), 'why', L({ grade: null })))).toContain('10-s1');
  });
});

test('⛔7/⛔12: not recommendable, programme intro, broken media, media_ok:false never', () => {
  const c = copy((d) => { mod(d, 11).media_ok = false; });
  const r = S.build(c, tgt('C1'), ctx({ level: null }), 'why welcome course broken', L({ grade: null }));
  for (const id of ['10-s3', '16-s1', '17-s1', '11-s1']) expect(ids(r)).not.toContain(id);
});

describe('declared holes (v4 ids only)', () => {
  test('a v4 target in holes[] → none:hole before retrieval', () => {
    const c = copy((d) => { seg(d, '14-s1').fico.push({ indicator: 'D3', strength: 1 }); });
    expect(S.build(c, tgt('D3'), ctx(), 'x', L()).noneReason).toBe('hole');
  });
  test('a native 37-id match is never hole-checked (37-D3 is not v4-D3)', () => {
    const c = copy((d) => { seg(d, '14-s1').fico_main37 = ['D3']; });
    expect(ids(S.build(c, tgt('D3', { native37: true }), ctx(), 'feedback', L()))).toEqual(['14-s1']);
  });
});

test('native 37-id path matches fico_main37, not fico', () => {
  expect(ids(S.build(cat, tgt('C8', { native37: true }), ctx(), 'explain', L()))).toEqual(['11-s2']);
});

test('approx aliases: any of the indicators', () => {
  expect(set(S.build(cat, tgt('C2', { indicators: ['C2', 'C3'] }), ctx({ level: null }), 'x', L({ grade: null })))).toEqual(new Set(['11-s2', '14-s1']));
});

describe('card_text path (H3)', () => {
  const t = { indicator: null, indicators: [], moves: [], source: 'card_text', cardText: 'Ask why and how questions' };
  test('no indicator filter; the chosen chapter\'s first fico row is its indicator', () => {
    const r = S.build(cat, t, ctx(), 'Ask why and how questions open yes no', L());
    expect(r.noneReason).toBeNull();
    expect(ids(r)[0]).toBe('10-s1');
    expect(r.candidates[0].indicator).toBe('C1');
  });
  test('BM25 top < 2.0 → none:no_target', () => {
    expect(S.build(cat, { ...t, cardText: 'zzz' }, ctx(), 'qqq', L()).noneReason).toBe('no_target');
  });
});

test('a phase target matches by move', () => {
  expect(ids(S.build(cat, { indicator: null, indicators: [], moves: ['activate_prior_knowledge'], source: 'phase' }, ctx(), 'yesterday', L()))).toEqual(['19-s1']);
});

test('noneReason: hole / language', () => {
  expect(S.build(cat, tgt('F8'), ctx(), 'x', L()).noneReason).toBe('hole');
  expect(S.build(cat, tgt('B4'), ctx({ language: 'en', languages: ['en', 'mixed'] }), 'x', L()).noneReason).toBe('language');
});

test('Urdu tokens kept; never throws on junk', () => {
  expect(S.tokens('بچوں سے سوال پوچھیں why?')).toEqual(['بچوں', 'سے', 'سوال', 'پوچھیں', 'why']);
  expect(S.build(C.fromData(null), tgt('C1'), ctx(), null, null).noneReason).toBe('hole');
  expect(S.build(cat, null, null, null, null).noneReason).toBe('hole');
});
