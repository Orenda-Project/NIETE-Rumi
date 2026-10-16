'use strict';
/**
 * A passage text may be fixed on its own id only before its first exposure on any served tier; the file then keeps a
 * dated `changes` note. Every file that carries such a note must: describe each change (date, field, what, why, the
 * hash of the text before), have a before-hash that differs from the file's current hash, still record exactly the
 * numbers the passage check computes from the new text, and remain an unreleased check-pool draft.
 * Plus the content of each text fix. Pure: reads the files on disk.
 */
const fs = require('fs');
const path = require('path');
const Gate = require('../../../shared/services/child-test/passage-gate');

const PASSAGES = path.join(__dirname, '../../../shared/data/child-test/passages');
const read = (id) => JSON.parse(fs.readFileSync(path.join(PASSAGES, `${id}.json`), 'utf8'));
const all = () => fs.readdirSync(PASSAGES).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(PASSAGES, f), 'utf8')));

describe('passage text changes before first exposure', () => {
  test('the fixed passages carry a changes note', () => {
    const withNote = all().filter((p) => Array.isArray(p.changes)).map((p) => p.passage_id).sort();
    expect(withNote).toEqual(expect.arrayContaining(['en.read.3.ref01', 'ur.listen.3.ref01', 'ur.read.1.sparrow']));
  });

  test('every changes note is complete, and the file still records what the passage check computes', () => {
    const changed = all().filter((p) => Array.isArray(p.changes));
    expect(changed.length).toBeGreaterThan(0);
    for (const p of changed) {
      const keys = Object.keys(p);
      expect([p.passage_id, keys[keys.length - 1]]).toEqual([p.passage_id, 'changes']);
      expect([p.passage_id, p.changes.length > 0]).toEqual([p.passage_id, true]);
      for (const c of p.changes) {
        expect(c.at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(Number.isNaN(Date.parse(`${c.at}T00:00:00Z`))).toBe(false);
        for (const k of ['field', 'what', 'why']) expect([p.passage_id, k, typeof c[k] === 'string' && c[k].trim().length > 0]).toEqual([p.passage_id, k, true]);
        expect(c.text_hash_before).toMatch(/^[0-9a-f]{32}$/);
        expect(c.text_hash_before).not.toBe(p.text_hash);
      }
      const res = Gate.checkPassage(p);
      expect([p.passage_id, res.problems]).toEqual([p.passage_id, []]);
      expect(res.ok).toBe(true);
      expect(p.text_hash).toBe(Gate.measure(p).text_hash);
      expect([p.passage_id, p.pool, p.status_at_authoring]).toEqual([p.passage_id, 'check', 'draft']);
    }
  });

  test('en.read.3.ref01: sentence 3 no longer says he looked on each table', () => {
    const p = read('en.read.3.ref01');
    expect(p.text).not.toMatch(/each table/i);
    expect(Gate.sentences(p.text)[2]).toBe('He looked, but it was not there.');
    expect(Gate.sentences(p.text)[6]).toBe('The book was on a table near the door.');
    expect(p.changes[0].text_hash_before).toBe('f6e39b15c2477324470f188fc77b80df');
  });

  test('ur.listen.3.ref01: the last sentence names the vegetable seller', () => {
    const p = read('ur.listen.3.ref01');
    expect(p.text.endsWith('اسی سبزی والے سے سبزی لی۔')).toBe(true);
    expect(p.changes[0].text_hash_before).toBe('896e52ec72935ebb1dcd659c3ab44952');
  });

  test('ur.read.1.sparrow: sentence 1 brings the sparrow into view, not up to the child', () => {
    const p = read('ur.read.1.sparrow');
    expect(Gate.sentences(p.text)[0]).toBe('ایک چھوٹی چڑیا نمرہ کو نظر آئی۔');
    expect(p.changes.find((c) => c.field === 'text').text_hash_before).toBe('cf7320656d516694cb13d39dd13f0815');
  });
});
