'use strict';
/**
 * bd-v0toag.9 — the curriculum SLO code shown on a quiz question in place of S1/S2.
 * The code comes only from the lesson plan's slide script; one code maps to every digest SLO,
 * anything else (none, several, a transcript quiz) leaves no code and says why. Never invented.
 */
const Code = require('../../bot/shared/services/quiz/quiz-slo-code');

const DIGEST = { slos: [{ id: 'S1' }, { id: 'S2' }] };

describe('codesFor', () => {
  test('one code on the slide script → every digest SLO gets it', () => {
    expect(Code.codesFor({ sloCode: 'M-02-DV-01', digest: DIGEST }))
      .toEqual({ status: 'one_code', codes: { S1: 'M-02-DV-01', S2: 'M-02-DV-01' } });
  });

  test('the same code twice is still one code', () => {
    expect(Code.codesFor({ sloCode: ' M-02-DV-01, M-02-DV-01 ', digest: DIGEST }).status).toBe('one_code');
  });

  test('several codes → no codes (which S-id is which code is design pending)', () => {
    expect(Code.codesFor({ sloCode: 'M-02-DV-01, M-02-DV-02', digest: DIGEST }))
      .toEqual({ status: 'several_codes', codes: {} });
  });

  test.each([[undefined], [null], [''], ['  ']])('no code (%p) → missing', (sloCode) => {
    expect(Code.codesFor({ sloCode, digest: DIGEST })).toEqual({ status: 'missing', codes: {} });
  });

  test('a digest with no SLOs → missing, nothing to label', () => {
    expect(Code.codesFor({ sloCode: 'M-02-DV-01', digest: { slos: [] } }).status).toBe('missing');
  });

  test('a numeric lp612 code is kept as text', () => {
    expect(Code.codesFor({ sloCode: 1234, digest: { slos: [{ id: 'S1' }] } }).codes).toEqual({ S1: '1234' });
  });
});

describe('sloIdOf', () => {
  test('reads the S-id out of a tq external id', () => {
    expect(Code.sloIdOf('tq:abc-123:S2:1')).toBe('S2');
  });
  test.each([[null], [''], ['other:x'], ['tq:abc']])('anything else (%p) → null', (x) => {
    expect(Code.sloIdOf(x)).toBeNull();
  });
});

describe('codeOf', () => {
  const meta = { slo_codes: { S1: 'M-02-DV-01' } };
  test('the code for a question, from quiz meta', () => {
    expect(Code.codeOf(meta, 'tq:q:S1:3')).toBe('M-02-DV-01');
  });
  test('no code for that SLO → null (the caller keeps the old label)', () => {
    expect(Code.codeOf(meta, 'tq:q:S2:1')).toBeNull();
    expect(Code.codeOf({}, 'tq:q:S1:1')).toBeNull();
    expect(Code.codeOf(null, 'tq:q:S1:1')).toBeNull();
  });
});
