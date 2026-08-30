/**
 * /roster — the roster<->TextArea bridge.
 *
 * The REVIEW screen is the whole product: the coach sees every extracted student
 * and edits any of them in place. Flows have no repeater or editable table, so a
 * prefilled TextArea IS the edit surface, and TextArea is capped at 600 characters
 * by Meta. Everything below exists because of those two facts.
 *
 * RED FIRST: bot/shared/services/roster/roster-lines.js does not exist yet.
 */

const {
  CHUNK_CHAR_CAP,
  toChunks,
  parseChunk,
  reconcile,
} = require('../../bot/shared/services/roster/roster-lines');

const student = (i, name, father, roll) => ({
  id: `uuid-${i}`,
  roll_number: roll === undefined ? String(i + 1) : roll,
  student_name: name,
  father_name: father || null,
});

describe('toChunks — rendering the roster into editable boxes', () => {
  it('numbers each line by roll number so an edited line can be mapped back', () => {
    const { chunks } = toChunks([student(0, 'Ayesha', 'Bilal'), student(1, 'Hadia', 'Saleem')]);
    expect(chunks[0]).toBe('1. Ayesha / Bilal\n2. Hadia / Saleem');
  });

  it('omits the father separator when there is no father name', () => {
    const { chunks } = toChunks([student(0, 'Zeeshan', null)]);
    expect(chunks[0]).toBe('1. Zeeshan');
  });

  it('never exceeds the 600-character TextArea cap in any chunk', () => {
    // 60 students with father names is ~3,240 chars — this is why there are six
    // boxes and not four. Four (2,400) silently truncated a class this size.
    const many = Array.from({ length: 60 }, (_, i) =>
      student(i, `Muhammad Student Number ${i}`, `Father Of Student ${i}`));
    const { chunks } = toChunks(many);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(CHUNK_CHAR_CAP);
    // and nothing is lost in the split
    expect(chunks.join('\n').split('\n')).toHaveLength(60);
  });

  it('returns labels that fit the 20-character TextArea label cap', () => {
    const many = Array.from({ length: 41 }, (_, i) => student(i, `Child ${i}`, `Father ${i}`));
    const { labels } = toChunks(many);
    for (const l of labels) expect(l.length).toBeLessThanOrEqual(20);
    expect(labels[0]).toMatch(/^Students 1-/);
  });

  it('exposes visibility flags so unused boxes stay hidden on a static screen', () => {
    const { visible } = toChunks([student(0, 'Solo', null)]);
    expect(visible).toEqual([true, false, false, false, false, false]);
  });

  it('refuses to silently drop students past the last box', () => {
    const tooMany = Array.from({ length: 400 }, (_, i) => student(i, `Child ${i}`, `Father ${i}`));
    const { overflow } = toChunks(tooMany);
    expect(overflow).toBeGreaterThan(0);
  });
});

describe('parseChunk — reading the coach edits back', () => {
  it('strips the roll-number prefix and splits student from father', () => {
    expect(parseChunk('14. Ayesha Bilal / Bilal Ahmed')).toEqual([
      { roll: '14', student_name: 'Ayesha Bilal', father_name: 'Bilal Ahmed' },
    ]);
  });

  it('survives a coach who deletes the numbering', () => {
    expect(parseChunk('Ayesha Bilal')).toEqual([
      { roll: null, student_name: 'Ayesha Bilal', father_name: null },
    ]);
  });

  it('ignores blank lines and Windows line endings from a paste', () => {
    expect(parseChunk('1. A\r\n\r\n2. B')).toHaveLength(2);
  });

  it('keeps Urdu script intact', () => {
    const [row] = parseChunk('3. عائشہ / بلال');
    expect(row.student_name).toBe('عائشہ');
    expect(row.father_name).toBe('بلال');
  });
});

describe('reconcile — matching edits back to student identities', () => {
  const originals = [student(0, 'Ayesha', 'Bilal'), student(1, 'Jabeen', 'Akram'), student(2, 'Zoha', 'Rauf')];

  it('matches by roll number, not by position, so a deleted line cannot shift identities', () => {
    const edits = parseChunk('1. Ayesha / Bilal\n3. Zoha / Rauf');
    const out = reconcile(originals, edits);
    expect(out.updated).toHaveLength(0);
    expect(out.removed.map((s) => s.id)).toEqual(['uuid-1']);
  });

  it('reports a corrected name as an update against the right uuid', () => {
    const edits = parseChunk('1. Ayesha / Bilal\n2. Sabeen / Akram\n3. Zoha / Rauf');
    const out = reconcile(originals, edits);
    expect(out.updated).toEqual([
      { id: 'uuid-1', student_name: 'Sabeen', father_name: 'Akram' },
    ]);
  });

  it('treats an unnumbered new line as an addition, never as an edit of someone else', () => {
    const edits = parseChunk('1. Ayesha / Bilal\n2. Jabeen / Akram\n3. Zoha / Rauf\nNew Child / New Father');
    const out = reconcile(originals, edits);
    expect(out.added).toEqual([{ student_name: 'New Child', father_name: 'New Father' }]);
    expect(out.updated).toHaveLength(0);
    expect(out.removed).toHaveLength(0);
  });

  it('is a no-op when the coach changes nothing — the common case must write nothing', () => {
    const { chunks } = toChunks(originals);
    const edits = chunks.flatMap(parseChunk);
    const out = reconcile(originals, edits);
    expect(out).toEqual({ updated: [], added: [], removed: [] });
  });
});
