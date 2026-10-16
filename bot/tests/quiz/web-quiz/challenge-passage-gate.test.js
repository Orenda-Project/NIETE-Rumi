'use strict';
/**
 * The passage check that gates every Challenge passage file before a person reads it (the machine half of the
 * content spec: band numbers, readability against the textbook word lists, no numerals, no test words, the
 * reachable tap questions in the first two lines). The module is pure (no network, no database); nothing is faked.
 *
 * (a) the check itself on tiny made-up passages; (b) every file in shared/data/child-test/passages passes it,
 * its recorded numbers are the computed ones, and the stock keeps its pool rules.
 */
const fs = require('fs');
const path = require('path');
const G = require('../../../shared/services/child-test/passage-gate');

const PASSAGES = path.join(__dirname, '../../../shared/data/child-test/passages');

// A small band-1 read passage built to pass; each test below breaks one rule.
const BASE_TEXT = 'Zara had a blue kite. She took it to the park. The wind was strong that day. '
  + 'The kite went high in the sky. Zara gave the line to her friend. The friend was very happy.';

function q(id, needsLine, prompt, right, wrong, extra = {}) {
  return {
    id, needs_line: needsLine, type: 'literal', tap_ok: true, prompt, right, wrong,
    accept: [right], reject: [...wrong], rubric: `Right if the child says ${right}.`, ...extra,
  };
}

function base(over = {}) {
  const p = {
    passage_id: 'en.read.1.sample', lang: 'en', kind: 'read', band: 1, pool: 'check',
    status_at_authoring: 'draft', is_reference: false, readability_list: 'fed-cum-g2-2026',
    source_ref: 'made-up sample', licence: 'generated', title_en: 'The Blue Kite', title_ur: null,
    names: ['Zara'], text: BASE_TEXT,
    questions: [
      q('q1', 1, 'What colour was the kite?', 'blue', ['pink', 'yellow']),
      q('q2', 1, 'What did Zara have?', 'a kite', ['a ball', 'a book']),
      q('q3', 2, 'Where did Zara take the kite?', 'to the park', ['to school', 'to the shop']),
    ],
    params: { reserve: false }, twin_of: null, bank_version: 'child-test-items-v4',
    ...over,
  };
  return { ...p, ...G.measure(p) };
}

const has = (res, code) => res.problems.some((x) => x.startsWith(`${code}:`));

describe('passage check: the rules on made-up passages', () => {
  test('tokenise keeps the scored words in reading order, punctuation stripped', () => {
    expect(G.tokenise('Zara dug a hole, put it in. "Yes!"', 'en')).toEqual(['Zara', 'dug', 'a', 'hole', 'put', 'it', 'in', 'Yes']);
    expect(G.sentences('One two. Three four! Five?')).toEqual(['One two.', 'Three four!', 'Five?']);
  });

  test('Urdu: diacritics are stripped and a digraph such as «بھ» is one letter', () => {
    expect(G.tokenise('بِلّی، بھاگی۔', 'ur')).toEqual(['بلی', 'بھاگی']);
    expect(G.letters('بھاگی', 'ur')).toBe(4);
    expect(G.letters('kite', 'en')).toBe(4);
  });

  test('readability is the share of word types in the list, names left out, case folded', () => {
    const r = G.readability('Zara had a kite. The kite was blue.', 'en', 'fed-cum-g2-2026', { names: ['Zara'] });
    expect(r).toBe(1);
    const r2 = G.readability('The zebra was blue.', 'en', 'fed-cum-g2-2026', { names: [] });
    expect(r2).toBe(0.75);
  });

  test('the sample passes', () => {
    const res = G.checkPassage(base());
    expect(res.problems).toEqual([]);
    expect(res.ok).toBe(true);
    expect(res.metrics).toMatchObject({ q_reach_1: 2, q_reach_2: 3, q_n: 3 });
  });

  test('a numeral in the text fails', () => {
    const p = base({ text: BASE_TEXT.replace('The wind', 'The 2 winds') });
    expect(has(G.checkPassage(p), 'numeral')).toBe(true);
  });

  test('a numeral in an option fails', () => {
    const p = base();
    p.questions[0].wrong = ['pink', '3'];
    p.questions[0].reject = ['pink', '3'];
    expect(has(G.checkPassage(p), 'numeral')).toBe(true);
  });

  test('only two questions in lines 1–2 fails', () => {
    const p = base();
    p.questions[2].needs_line = 3;
    const res = G.checkPassage(p);
    expect(res.metrics.q_reach_2).toBe(2);
    expect(has(res, 'reach')).toBe(true);
  });

  test('only one question on line 1 fails', () => {
    const p = base();
    p.questions[1].needs_line = 2;
    expect(has(G.checkPassage(p), 'reach')).toBe(true);
  });

  test('the band caps the MEAN words a sentence: mean 7.0 with one 8-word sentence passes, with a warning', () => {
    const p = base({ text: 'Zara had a new blue kite that day. She took the kite to the park. The kite went high in the sky. '
      + 'Zara gave the line to her friend. The friend was very happy too.' });
    const res = G.checkPassage(p);
    expect(res.metrics.mean_sent_len).toBe(7);
    expect(res.problems).toEqual([]);
    expect(res.warnings.some((w) => w.startsWith('sentence_len:'))).toBe(true);
  });

  test('a band-1 passage with mean 7.5 words a sentence fails', () => {
    const p = base({ text: 'Zara had a new blue kite that day. She took the new kite to the park. The kite went high in the sky. '
      + 'Zara gave the line to her friend.' });
    const res = G.checkPassage(p);
    expect(res.metrics.mean_sent_len).toBe(7.5);
    expect(res.problems.some((x) => x.startsWith('sentence_len: mean'))).toBe(true);
  });

  test('one sentence more than three words over the band cap still fails', () => {
    const p = base({ text: BASE_TEXT.replace('The kite went high in the sky.', 'The kite went very high in the sky that day with the wind.') });
    expect(has(G.checkPassage(p), 'sentence_len')).toBe(true);
  });

  test('a recorded mean within rounding (0.06) of the computed one is accepted; further off is not', () => {
    const p = base();
    p.mean_sent_len = Math.round((p.mean_sent_len + 0.05) * 100) / 100;
    expect(has(G.checkPassage(p), 'recorded')).toBe(false);
    p.mean_sent_len += 0.1;
    expect(has(G.checkPassage(p), 'recorded')).toBe(true);
  });

  test('a test word in an option fails', () => {
    const p = base();
    p.questions[2].wrong = ['to school', 'to the test'];
    p.questions[2].reject = ['to school', 'to the test'];
    expect(has(G.checkPassage(p), 'test_word')).toBe(true);
  });

  test('a "don\'t know" option fails', () => {
    const p = base();
    p.questions[0].wrong = ['pink', "don't know"];
    p.questions[0].reject = ['pink', "don't know"];
    expect(has(G.checkPassage(p), 'not_an_answer')).toBe(true);
  });

  test('a tap question needs one right and two distinct wrong options', () => {
    const p = base();
    p.questions[1].wrong = ['a ball', 'a ball'];
    p.questions[1].reject = ['a ball', 'a ball'];
    expect(has(G.checkPassage(p), 'tap')).toBe(true);
    const p2 = base();
    p2.questions[1].wrong = ['a ball'];
    expect(has(G.checkPassage(p2), 'tap')).toBe(true);
  });

  test('a word from the familiar-word task fails', () => {
    const p = base({ text: BASE_TEXT.replace('The friend was very happy.', 'The friend was very sad.') });
    expect(has(G.checkPassage(p), 'task_word')).toBe(true);
  });

  test('first person fails', () => {
    const p = base({ text: BASE_TEXT.replace('Zara gave the line to her friend.', 'Zara gave the line to my friend.') });
    expect(has(G.checkPassage(p), 'first_person')).toBe(true);
  });

  test('too few words for the band fails, and a recorded number that is not the computed one fails', () => {
    const p = base({ text: 'Zara had a blue kite. She took it to the park. The wind was strong that day.' });
    expect(has(G.checkPassage(p), 'tokens')).toBe(true);
    const p2 = base();
    p2.tokens += 1;
    expect(has(G.checkPassage(p2), 'recorded')).toBe(true);
  });

  test('a band-1 passage under 0.95 on the band-2 list fails even when its own list passes', () => {
    // two content words outside both lists out of ~25 types: own list may pass the 0.90 floor, band-above must not
    const p = base({ text: BASE_TEXT.replace('blue kite', 'blue zither').replace('high in the sky', 'high in the azure') });
    const res = G.checkPassage(p);
    expect(res.metrics.readability_g3).toBeLessThan(0.95);
    expect(has(res, 'readability')).toBe(true);
  });
});

describe('passage check: the stock on disk', () => {
  const files = fs.readdirSync(PASSAGES).filter((f) => f.endsWith('.json')).sort();
  const all = files.map((f) => ({ file: f, p: JSON.parse(fs.readFileSync(path.join(PASSAGES, f), 'utf8')) }));
  const own = all.filter(({ p }) => !p.v3_ref);

  test('there is stock to check', () => {
    expect(own.length).toBeGreaterThanOrEqual(10);
  });

  test.each(all.map(({ file, p }) => [file, p]))('%s passes the check', (file, p) => {
    expect(`${p.passage_id}.json`).toBe(file);
    const res = G.checkPassage(p);
    expect(res.problems).toEqual([]);
  });

  test.each(own.map(({ file, p }) => [file, p]))('%s records the computed numbers', (file, p) => {
    const m = G.measure(p);
    for (const k of ['tokens', 'sentences', 'max_word_len', 'readability', 'readability_band_above',
      'tokens_list', 'lines', 'text_hash', 'q_reach_1', 'q_reach_2', 'q_n']) {
      expect([k, p[k]]).toEqual([k, m[k]]);
    }
    // the mean is rounded to one place; a file written by another language's rounding may differ by one step
    expect(Math.abs(p.mean_sent_len - m.mean_sent_len)).toBeLessThanOrEqual(0.06);
  });

  test('text_hash is unique across files, and no practice text is a check text', () => {
    const hashes = all.map(({ p }) => G.measure(p).text_hash);
    expect(new Set(hashes).size).toBe(hashes.length);
    const check = new Set(all.filter(({ p }) => p.pool === 'check').map(({ p }) => G.measure(p).text_hash));
    for (const { p } of all.filter(({ p: x }) => x.pool === 'practice')) expect(check.has(G.measure(p).text_hash)).toBe(false);
  });

  test('practice and check passages never share a character', () => {
    for (const lang of new Set(own.map(({ p }) => p.lang))) {
      const names = (pool) => new Set(own.filter(({ p }) => p.lang === lang && p.pool === pool).flatMap(({ p }) => p.names || []));
      const check = names('check');
      for (const n of names('practice')) expect([n, check.has(n)]).toEqual([n, false]);
    }
  });

  test('every language present has its band-1 reserve story', () => {
    for (const lang of new Set(own.map(({ p }) => p.lang))) {
      const reserve = own.filter(({ p }) => p.lang === lang && p.params && p.params.reserve === true);
      expect(reserve.length).toBeGreaterThanOrEqual(1);
      for (const { p } of reserve) expect([p.pool, p.band]).toEqual(['practice', 1]);
    }
  });

  test('exactly one reference per (language, band, kind) among the check files present', () => {
    const cells = new Map();
    for (const { p } of all.filter(({ p: x }) => x.pool === 'check')) {
      const k = `${p.lang}.${p.kind}.${p.band}`;
      cells.set(k, (cells.get(k) || 0) + (p.is_reference ? 1 : 0));
    }
    for (const [k, n] of cells) expect([k, n]).toEqual([k, 1]);
    for (const { p } of all.filter(({ p: x }) => x.pool === 'practice')) expect(p.is_reference).toBe(false);
  });
});
