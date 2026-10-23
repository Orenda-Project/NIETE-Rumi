'use strict';
/**
 * bd-gzfdu9 — prompt.build (SPEC v1.2.1 §3.4, vr-2) and the transcript moments it may quote, names redacted.
 */
const P = require('../../../bot/shared/services/coaching/video-reco/prompt');
const C = require('../../../bot/shared/services/coaching/video-reco/catalog');

const cat = C.fromData(require('./fixtures/catalog.fixture.json'));
const segs = Array.from({ length: 30 }, (_, i) => ({
  start_ms: i * 20000, label: i % 2 ? 'Student' : 'Teacher', text: `line ${i} ${'x'.repeat(i === 7 ? 400 : 3)}`,
}));
const session = { diarization_data: { segments: segs }, transcript_text: '' };
const target = { indicator: 'C1', source: 'step', row: { id: 'C1', name: 'Quality Questioning', score: 1, timestamp: '[03:10]' } };
const cands = [{ seg_id: '10-s1', indicator: 'C1' }, { seg_id: '11-s1', indicator: 'C1' }];

test('PROMPT_VERSION is vr-7 (vr-6 + R7b: the clip\'s own words, the Urdu plural)', () => {
  expect(P.PROMPT_VERSION).toBe('vr-7');
});

test('excerpts: the 12 diarized segments around the target timestamp, [mm:ss] Label: text, ≤ 220 chars each', () => {
  const ex = P.excerpts(session, { timestamp: '[03:10]' });
  expect(ex).toHaveLength(12);
  expect(ex.some((l) => l.startsWith('[03:00] Student: line 9'))).toBe(true);
  expect(ex.every((l) => [...l].length <= 220)).toBe(true);
});

test('excerpts: no timestamp → around the uptake moment, else the first 12; no diarization → [mm:ss] transcript lines; nothing → []', () => {
  expect(P.excerpts(session, { timestamp: '[...]', uptakeMoment: 'at 06:40 the teacher waited' })[0]).toMatch(/^\[0[4-6]:/);
  expect(P.excerpts(session, {})[0]).toBe('[00:00] Teacher: line 0 xxx');
  expect(P.excerpts({ transcript_text: 'header\n[00:05] Teacher (ur): سلام\nno stamp' }, {})).toEqual(['[00:05] Teacher (ur): سلام']);
  expect(P.excerpts(null, {})).toEqual([]);
});

test('H8: children\'s names and the teacher\'s own name are redacted in the excerpts', () => {
  const s = { diarization_data: { segments: [
    { start_ms: 1000, label: 'Teacher', text: 'Ahmed, tum batao is this a triangle?' },
    { start_ms: 5000, label: 'Teacher', text: 'Saima here, everyone listen' },
  ] } };
  const ex = P.excerpts(s, {}, { teacher: 'Saima Khan' });
  expect(ex[0]).toBe('[00:01] Teacher: [a student], tum batao is this a triangle?');
  expect(ex[1]).not.toMatch(/Saima/);
});

test('build (indicator path): the vr-2 text, the score of the scheme\'s max, the scorer\'s quote as the default moment', () => {
  const ex = P.excerpts(session, { timestamp: '[03:10]' });
  const prompt = P.build({ target, rationale: 'Few open questions', tryText: 'Ask two why questions', subject: 'maths', excerpts: ex, candidates: cands, catalog: cat, scorerQuote: 'Is this red? Yes or no', topRung: 2 });
  expect(prompt).toContain("You are the Digital Coach's video picker for a government-school teacher in Pakistan.");
  expect(prompt).toContain('Indicator: C1 — Quality Questioning (scored 1 of 2 in this lesson)');
  expect(prompt).toContain('Try this tomorrow: Ask two why questions');
  expect(prompt).toContain('The report\'s own moment: "Is this red? Yes or no" (around [03:10]). Cite it unless a transcript line below fits the clip better.');
  expect(prompt).toContain(ex[0]);
  expect(prompt).toContain('10-s1 · Ask why and how · 90s · ur · The teacher turns yes/no questions into why and how questions. · needs:  · C1');
  expect(prompt).toContain('1. Choose the clip that SHOWS the exact move in "Try this tomorrow". Every candidate is for that step: you choose among them and ground the moment; you never change the step.');
  expect(prompt).toContain('The quote must contain no person\'s name: write [a student] in its place.');
  expect(prompt).toContain('meant for a different subject than this lesson (maths)');
  expect(prompt).toContain('{"seg_id": "<one of the candidate ids, or null>", "moment": {"at": "mm:ss", "quote": "<copied from the transcript moments>"}, "reason_en"');
  expect(prompt).not.toContain('differs_from_step');
});

test('build: the 37 scheme says "of 4"; an unknown subject says unknown', () => {
  const prompt = P.build({ target: { ...target, row: { ...target.row, score: 2 } }, topRung: 4, excerpts: [], candidates: [], catalog: cat, scorerQuote: 'q' });
  expect(prompt).toContain('(scored 2 of 4 in this lesson)');
  expect(prompt).toContain('this lesson (unknown)');
});

test('build (card_text path): the indicator is not named, the card is the step, the uptake quote (if any) is the evidence', () => {
  const t = { source: 'card_text', indicator: null, cardText: 'Give the fast finishers a harder sum' };
  const p1 = P.build({ target: t, tryText: 'Give the fast finishers a harder sum', excerpts: ['[00:01] Teacher: ok'], candidates: cands, catalog: cat, uptakeQuote: 'finished early' });
  expect(p1).toContain('Indicator: not named — the step is the sentence below');
  expect(p1).toContain('Try this tomorrow: Give the fast finishers a harder sum');
  expect(p1).toContain('The report\'s own moment: "finished early"');
  const p2 = P.build({ target: t, tryText: 'x', excerpts: ['[00:01] Teacher: ok'], candidates: cands, catalog: cat });
  expect(p2).not.toContain('The report\'s own moment');
});

test("build: no transcript lines but a scorer quote → the prompt says to cite the report's moment", () => {
  const prompt = P.build({ target, excerpts: [], candidates: cands, catalog: cat, scorerQuote: 'Yes or no' });
  expect(prompt).toContain('(no transcript lines for this lesson: cite the report\'s moment above)');
});
