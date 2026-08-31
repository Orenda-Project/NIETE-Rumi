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
  renderList,
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
    expect(out.added).toEqual([{ roll: null, student_name: 'New Child', father_name: 'New Father' }]);
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

/**
 * An unreadable roll number is shown as an unreadable roll number.
 *
 * Field test 2026-08-30: three children whose rolls were hidden behind a drawing
 * came back from the model as 10, 11 and 12 — the page numbers them 35, 36, 37.
 * The extractor now abstains instead of inferring, which leaves the roll null, and
 * that null has to survive all the way to the coach's eyes. Rendering the ordinal
 * in its place would recreate exactly the bug, one layer down: the coach would read
 * "12." as a roll number we had read off the page.
 */
describe('an unreadable roll number renders as ?, not as an invented number', () => {
  const unknown = (name, father) => ({
    id: `u-${name}`, roll_number: null, student_name: name, father_name: father || null,
  });

  it('prefixes a student with no roll number with ?', () => {
    const { chunks } = toChunks([student(0, 'Ayesha', 'Bilal'), unknown('Minahil', 'Asif')]);
    expect(chunks[0]).toBe('1. Ayesha / Bilal\n?. Minahil / Asif');
  });

  it('reads a ? line back as a student with no roll number', () => {
    expect(parseChunk('?. Minahil / Asif')).toEqual([
      { roll: null, student_name: 'Minahil', father_name: 'Asif' },
    ]);
  });

  it('lets the coach supply the real roll number by typing over the ?', () => {
    expect(parseChunk('35. Minahil / Asif')[0].roll).toBe('35');
  });

  it('matches ?-lines back to the right children in order, and calls nothing an addition', () => {
    const originals = [unknown('Minahil', 'Asif'), unknown('Hooria', 'Kamran')];
    const { chunks } = toChunks(originals);
    const out = reconcile(originals, chunks.flatMap(parseChunk));
    expect(out).toEqual({ updated: [], added: [], removed: [] });
  });

  it('attributes a correction on a ?-line to the child it was rendered for', () => {
    const originals = [unknown('Minahil', 'Asif'), unknown('Hooria', 'Kamran')];
    const out = reconcile(originals, parseChunk('?. Minahil / Asif\n?. Hooriya / Kamran'));
    expect(out.updated).toEqual([
      { id: 'u-Hooria', student_name: 'Hooriya', father_name: 'Kamran' },
    ]);
  });
});

/**
 * The readable list. A TextArea has no height property and no scrollbar, so the
 * boxes cannot be made bigger — a coach reading a 40-name class through one saw
 * four names and thought that was the whole extraction. The list is therefore
 * rendered once, in full, as a TextBody above the boxes.
 */
describe('renderList — the whole class, readable, above the edit boxes', () => {
  it('renders every student on its own line, in roster order', () => {
    const text = renderList([student(0, 'Ayesha', 'Bilal'), student(1, 'Hadia', null)]);
    expect(text.split('\n')).toEqual(['1. Ayesha / Bilal', '2. Hadia']);
  });

  it('stays inside the TextBody character budget and says what it could not show', () => {
    const many = Array.from({ length: 300 }, (_, i) =>
      student(i, `Muhammad Student Number ${i}`, `Father Of Student ${i}`));
    const text = renderList(many);
    expect(text.length).toBeLessThanOrEqual(4000);
    expect(text).toMatch(/more below/);
  });

  it('is empty for an empty roster rather than throwing', () => {
    expect(renderList([])).toBe('');
  });
});

describe('helper text — the count that tells a coach the box is a slice, not the class', () => {
  it('names the slice and the class size, within Metas 80-character helper cap', () => {
    const many = Array.from({ length: 41 }, (_, i) => student(i, `Child ${i}`, `Father ${i}`));
    const { helpers, visible } = toChunks(many);
    helpers.forEach((h) => expect(h.length).toBeLessThanOrEqual(80));
    expect(helpers[0]).toContain('of 41');
    // A hidden box still needs a string — the screen is static.
    expect(helpers).toHaveLength(visible.length);
  });
});

/**
 * Edit mode (coach-requested, pre-prod): reconcile's diffs become DATABASE
 * actions against existing children, so two things matter that import never
 * needed: an added line keeps the roll the coach typed, and a roll correction
 * must resolve to the SAME child moving — not a remove+create that would split
 * her identity and strand her attendance history.
 */
const { pairMoves } = require('../../bot/shared/services/roster/roster-lines');

describe('reconcile for edit mode', () => {
  const DB = [
    { id: 'st-1', roll_number: 1, student_name: 'Ayesha', father_name: 'Bilal' },
    { id: 'st-2', roll_number: 2, student_name: 'Minahil', father_name: 'Asif' },
  ];

  it('an added line carries the roll the coach typed', () => {
    const diff = reconcile(DB, [
      { roll: '1', student_name: 'Ayesha', father_name: 'Bilal' },
      { roll: '2', student_name: 'Minahil', father_name: 'Asif' },
      { roll: '3', student_name: 'Hooria', father_name: null },
    ]);
    expect(diff.added).toEqual([{ roll: '3', student_name: 'Hooria', father_name: null }]);
  });

  it('a roll correction pairs the removed and added rows into a MOVE of the same child', () => {
    const diff = reconcile(DB, [
      { roll: '7', student_name: 'Ayesha', father_name: 'Bilal' }, // 1 → 7, same child
      { roll: '2', student_name: 'Minahil', father_name: 'Asif' },
    ]);
    const paired = pairMoves(diff);
    expect(paired.moved).toEqual([{ id: 'st-1', roll: '7' }]);
    expect(paired.added).toEqual([]);
    expect(paired.removed).toEqual([]);
  });

  it('pairMoves never pairs different children just because a slot opened', () => {
    const diff = reconcile(DB, [
      { roll: '2', student_name: 'Minahil', father_name: 'Asif' },
      { roll: '9', student_name: 'Zainab', father_name: null }, // genuinely new
    ]); // Ayesha genuinely removed
    const paired = pairMoves(diff);
    expect(paired.moved).toEqual([]);
    expect(paired.added).toEqual([{ roll: '9', student_name: 'Zainab', father_name: null }]);
    expect(paired.removed.map((r) => r.id)).toEqual(['st-1']);
  });
});
