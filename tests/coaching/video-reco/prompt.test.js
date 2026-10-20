'use strict';
/**
 * bd-gzfdu9 — prompt.build: the video picker's prompt (SPEC §3.4 text) and the transcript excerpts.
 */
const P = require('../../../bot/shared/services/coaching/video-reco/prompt');
const C = require('../../../bot/shared/services/coaching/video-reco/catalog');

const cat = C.fromData(require('./fixtures/catalog.fixture.json'));
const segs = Array.from({ length: 30 }, (_, i) => ({
  start_ms: i * 20000, label: i % 2 ? 'Student' : 'Teacher', text: `line ${i} ${'x'.repeat(i === 7 ? 400 : 3)}`,
}));
const session = { diarization_data: { segments: segs }, transcript_text: '' };
const target = { indicator: 'C1', stepIndicator: 'C1', row: { id: 'C1', name: 'Quality Questioning', score: 1, evidence: 'asked yes/no', evidence_summary: 'Mostly yes/no questions', timestamp: '[03:10]' } };

test('PROMPT_VERSION is vr-1', () => {
  expect(P.PROMPT_VERSION).toBe('vr-1');
});

test('excerpts: the 12 diarized segments around the target timestamp, [mm:ss] Label: text, ≤ 220 chars each', () => {
  const ex = P.excerpts(session, { timestamp: '[03:10]' });
  expect(ex).toHaveLength(12);
  expect(ex.some((l) => l.startsWith('[03:00] Student: line 9'))).toBe(true);
  expect(ex.every((l) => /^\[\d{2}:\d{2}\] (Teacher|Student): /.test(l))).toBe(true);
  expect(ex.every((l) => [...l].length <= 220)).toBe(true);
});

test('excerpts: no timestamp → around the uptake moment, else the first 12', () => {
  expect(P.excerpts(session, { timestamp: '[...]', uptakeMoment: 'at 06:40 the teacher waited' })[0]).toMatch(/^\[0[4-6]:/);
  expect(P.excerpts(session, {})[0]).toBe('[00:00] Teacher: line 0 xxx');
});

test('excerpts: no diarization → transcript_text lines that start with [mm:ss]', () => {
  const s = { transcript_text: 'header\n[00:05] Teacher (ur): سلام\n[00:09] Student (ur): جی\nno stamp line' };
  expect(P.excerpts(s, {})).toEqual(['[00:05] Teacher (ur): سلام', '[00:09] Student (ur): جی']);
});

test('excerpts: nothing → []', () => {
  expect(P.excerpts(null, {})).toEqual([]);
});

test('build: the SPEC text with the step, the excerpts, every candidate id and the JSON contract', () => {
  const ex = P.excerpts(session, { timestamp: '[03:10]' });
  const prompt = P.build({
    target, rationale: 'Few open questions', tryText: 'Ask two why questions', subject: 'maths', excerpts: ex,
    candidates: [{ seg_id: '10-s1', indicator: 'C1' }, { seg_id: '11-s1', indicator: 'C1' }], catalog: cat,
  });
  expect(prompt).toContain("You are the Digital Coach's video picker for a government-school teacher in Pakistan.");
  expect(prompt).toContain('Indicator: C1 — Quality Questioning (scored 1 of 2 in this lesson)');
  expect(prompt).toContain('Try this tomorrow: Ask two why questions');
  expect(prompt).toContain('Evidence the scorer quoted: Mostly yes/no questions (around [03:10])');
  expect(prompt).toContain(ex[0]);
  expect(prompt).toContain('10-s1 · Ask why and how · 90s · ur · The teacher turns yes/no questions into why and how questions. · needs:  · C1');
  expect(prompt).toContain('11-s1 ·');
  expect(prompt).toContain('meant for a different subject than this lesson (maths)');
  expect(prompt).toContain("6. The quote must contain no person's name: write [a student] in its place.");
  expect(prompt).toContain('Return exactly this JSON:');
  expect(prompt).toMatch(/JSON/);
});

test('build: the 37-scheme scale is said as "of 3"', () => {
  const prompt = P.build({ target: { ...target, row: { ...target.row, score: 2 } }, topRung: 3, excerpts: [], candidates: [], catalog: cat });
  expect(prompt).toContain('(scored 2 of 3 in this lesson)');
  expect(prompt).toContain('this lesson (unknown)');
});
