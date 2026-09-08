/**
 * /roster REVIEW — the edit boxes must stay editable, and a page with no roll
 * column must not print a question mark on every child.
 *
 * TWO FIELD REPORTS, ONE FILE.
 *
 * A. "600/600 word limit hai and I can't edit name." A coach photographing a
 *    54-child register got boxes rendered at 591/600, 599/600 and 336/600 with
 *    three more boxes sitting empty below. Box 2 was at the platform ceiling, so
 *    lengthening any name inside it was impossible — the register's "Habibullah"
 *    went into production as "Habibull" and "Waseem Abbas" as "Waseem Aba".
 *    toChunks() packs greedily to CHUNK_CHAR_CAP, which is Meta's HARD limit, so
 *    a full box has exactly zero room for the edit the screen exists to collect.
 *
 * B. "There are ? that appear next to each child's name — coaches get confused
 *    and start removing them." UNKNOWN_ROLL is meaningful next to numbered
 *    siblings; on a register with no roll column at all it is 43 identical
 *    question marks carrying no information, and coaches read it as breakage.
 *
 * Measured against ICT production 2026-09-08 (15,532 active enrolled children,
 * 470 classes): a rendered line is 16 code points at the median, 31 at p95, 36
 * at p99. 16% carry a father name. The fixtures below are synthetic but sized to
 * that p95 — real names never enter this repo.
 */

const {
  CHUNK_CHAR_CAP,
  MAX_BOXES,
  FILL_TARGET,
  EDIT_HEADROOM,
  HELPER_CAP,
  toChunks,
  parseChunk,
  renderLine,
  renderList,
  reconcile,
  pairMoves,
} = require('../../bot/shared/services/roster/roster-lines');

const cp = (s) => [...String(s)].length;

/** A child with a roll read off the page. */
const numbered = (i, name, father) => ({
  id: `uuid-${i}`, roll_number: String(i + 1), student_name: name, father_name: father || null,
});
/** A child whose roll the camera could not read. */
const unnumbered = (i, name, father) => ({
  id: `uuid-${i}`, roll_number: null, student_name: name, father_name: father || null,
});

// ~28-31 code points once rendered, which is production's p95.
const NAMES = ['Ayesha Bilal', 'M. Shahab Saqib', 'Syed M. Hassan', 'Hoorain Fatima',
  'Abdul-wasay', 'Mannat Fatima', 'M. Usman Nawaz', 'Zimal Zaheer', 'Khurram Abass'];
const FATHERS = ['Bilal Ahmed', 'Nazakat Ali', 'Qari Allah Baksh', 'Shah Faisal',
  'Mureed Qasim', 'Zaheer Abass', 'Bakht Nawaz', 'Asmatullah', 'Chaman Abass'];

const klass = (n, make) => Array.from({ length: n }, (_, i) =>
  make(i, NAMES[i % NAMES.length] + (i > 8 ? ` ${i}` : ''), FATHERS[i % FATHERS.length]));

const usedFills = (r) => r.chunks.filter((c, i) => r.visible[i]).map(cp);

// ---------------------------------------------------------------------------
// A. Every box keeps room to type in
// ---------------------------------------------------------------------------
describe('A. a rendered box always leaves the coach room to lengthen a name', () => {
  it('exposes a fill target strictly below Meta’s hard cap, with real headroom', () => {
    expect(FILL_TARGET).toBeLessThan(CHUNK_CHAR_CAP);
    expect(EDIT_HEADROOM).toBe(CHUNK_CHAR_CAP - FILL_TARGET);
    // p99 of a production line is 36 code points. Headroom must fit at least three
    // whole extra children, so a coach can add a missing child AND lengthen names.
    expect(EDIT_HEADROOM).toBeGreaterThanOrEqual(3 * 37);
  });

  it('leaves at least 100 free characters in every box of the 54-child field class', () => {
    // Deliberately independent of the new constants, so it states the defect in
    // the coach's own terms: the screen showed 591/600, 599/600 and 336/600 with
    // three boxes empty below, and box 2 could not take one more character.
    const fills = usedFills(toChunks(klass(54, numbered)));
    expect(fills.map((f) => CHUNK_CHAR_CAP - f).sort((a, b) => a - b)[0])
      .toBeGreaterThanOrEqual(100);
  });

  it('never renders a box at the 600 cap for the 54-child class from the field report', () => {
    const r = toChunks(klass(54, numbered));
    for (const fill of usedFills(r)) {
      expect(fill).toBeLessThanOrEqual(FILL_TARGET);
      expect(CHUNK_CHAR_CAP - fill).toBeGreaterThanOrEqual(EDIT_HEADROOM);
    }
    expect(r.overflow).toBe(0);
  });

  it('spreads the class across the boxes instead of filling box 1 before box 2', () => {
    const fills = usedFills(toChunks(klass(54, numbered)));
    expect(fills.length).toBeGreaterThan(1);
    // The complaint was 591 / 599 / 336 — two boxes at the ceiling and a third
    // barely used, with three empty boxes below. Balanced means the fullest and
    // the emptiest box differ by less than one box of headroom.
    expect(Math.max(...fills) - Math.min(...fills)).toBeLessThan(EDIT_HEADROOM);
  });

  it('opens no more boxes than the class needs', () => {
    // Headroom must not become "always use all six". A contiguous pack cannot
    // always hit the theoretical minimum exactly, but it must not exceed it by
    // more than one box.
    const used = usedFills(toChunks(klass(54, numbered)));
    const total = used.reduce((a, b) => a + b, 0);
    expect(used.length).toBeLessThanOrEqual(Math.ceil(total / FILL_TARGET) + 1);
  });

  it('keeps a small class in a single box and the rest hidden', () => {
    const r = toChunks(klass(6, numbered));
    expect(r.visible).toEqual([true, false, false, false, false, false]);
    expect(cp(r.chunks[0])).toBeLessThanOrEqual(FILL_TARGET);
  });

  it('never marks an empty box visible', () => {
    for (const n of [1, 6, 20, 43, 54, 80, 120]) {
      const r = toChunks(klass(n, numbered));
      r.chunks.forEach((c, i) => { if (r.visible[i]) expect(c.length).toBeGreaterThan(0); });
    }
  });
});

// ---------------------------------------------------------------------------
// A'. The lower target must not cost capacity
// ---------------------------------------------------------------------------
describe("A'. a lower fill target never drops a child that fits today", () => {
  it('still fits a 60-child class with father names, which needs the hard cap', () => {
    // 60 long lines is ~3,240 characters. Six boxes at the target hold 6 x
    // FILL_TARGET, which is less than that, so the packer must fall back to the
    // hard cap rather than report an overflow. Headroom is a preference; a child
    // reaching the screen is not.
    const many = Array.from({ length: 60 }, (_, i) =>
      numbered(i, `Muhammad Student Number ${i}`, `Father Of Student ${i}`));
    const r = toChunks(many);
    expect(r.overflow).toBe(0);
    for (const c of r.chunks) expect(cp(c)).toBeLessThanOrEqual(CHUNK_CHAR_CAP);
    expect(r.chunks.join('\n').split('\n').filter(Boolean)).toHaveLength(60);
  });

  it('reports, never silently drops, a class that cannot fit even at the hard cap', () => {
    const tooMany = Array.from({ length: 400 }, (_, i) =>
      numbered(i, `Child ${i}`, `Father ${i}`));
    const r = toChunks(tooMany);
    expect(r.overflow).toBeGreaterThan(0);
    const shown = r.chunks.join('\n').split('\n').filter(Boolean).length;
    expect(shown + r.overflow).toBe(400);
  });

  it('places every child somewhere for every class size the field produces', () => {
    for (let n = 1; n <= 120; n += 1) {
      const r = toChunks(klass(n, numbered));
      const shown = r.chunks.join('\n').split('\n').filter(Boolean).length;
      expect(shown + r.overflow).toBe(n);
      for (const c of r.chunks) expect(cp(c)).toBeLessThanOrEqual(CHUNK_CHAR_CAP);
      expect(r.chunks).toHaveLength(MAX_BOXES);
    }
  });
});

// ---------------------------------------------------------------------------
// B. The question mark
// ---------------------------------------------------------------------------
describe('B. "?." only where it means something', () => {
  it('drops the prefix entirely when no child on the page carries a roll', () => {
    const r = toChunks(klass(43, unnumbered));
    const lines = r.chunks.filter(Boolean).join('\n').split('\n');
    expect(lines).toHaveLength(43);
    for (const line of lines) expect(line.startsWith('?')).toBe(false);
    expect(lines[0]).toBe('Ayesha Bilal / Bilal Ahmed');
  });

  it('keeps "?." on a mixed page, where it distinguishes this child from her numbered neighbours', () => {
    const mixed = [
      numbered(11, 'Ali Raza', 'Hassan'),
      unnumbered(12, 'Sana Fatima', 'Iqbal'),
      numbered(13, 'Zoya', 'Kamran'),
    ];
    expect(toChunks(mixed).chunks[0].split('\n')).toEqual([
      '12. Ali Raza / Hassan',
      '?. Sana Fatima / Iqbal',
      '14. Zoya / Kamran',
    ]);
  });

  it('renders the read-only list the same way as the edit boxes', () => {
    const none = klass(43, unnumbered);
    expect(renderList(none).split('\n')[0]).toBe(toChunks(none).chunks[0].split('\n')[0]);
    const mixed = [numbered(0, 'Ali', 'Hassan'), unnumbered(1, 'Sana', 'Iqbal')];
    expect(renderList(mixed).split('\n')).toEqual(['1. Ali / Hassan', '?. Sana / Iqbal']);
  });

  it('renderLine still prints "?." on its own, which is the mixed-page default', () => {
    expect(renderLine(unnumbered(0, 'Sana', 'Iqbal'), 0)).toBe('?. Sana / Iqbal');
    expect(renderLine(unnumbered(0, 'Sana', 'Iqbal'), 0, false)).toBe('Sana / Iqbal');
  });

  it('says in the helper text that this page has no roll numbers, inside the 80-cp cap', () => {
    const none = toChunks(klass(43, unnumbered));
    none.helpers.forEach((h) => expect(cp(h)).toBeLessThanOrEqual(HELPER_CAP));
    expect(none.helpers[0]).toMatch(/no roll numbers/i);

    const some = toChunks(klass(43, numbered));
    some.helpers.forEach((h) => expect(cp(h)).toBeLessThanOrEqual(HELPER_CAP));
    expect(some.helpers[0]).not.toMatch(/no roll numbers/i);

    // The worst case for the cap is a three-digit range on a three-digit class.
    const big = toChunks(klass(120, unnumbered));
    big.helpers.forEach((h) => expect(cp(h)).toBeLessThanOrEqual(HELPER_CAP));
  });
});

// ---------------------------------------------------------------------------
// B'. The round trip, both directions
// ---------------------------------------------------------------------------
describe("B'. a prefix-less line round-trips exactly as a \"?.\" line did", () => {
  it('reads a bare line back as a child with no roll', () => {
    expect(parseChunk('Sana Fatima / Iqbal')).toEqual([
      { roll: null, student_name: 'Sana Fatima', father_name: 'Iqbal' },
    ]);
  });

  it('reads a roll the coach typed in front of a bare line', () => {
    expect(parseChunk('35. Sana Fatima / Iqbal')[0].roll).toBe('35');
  });

  it('renders 43 roll-less children, parses them back, and changes nothing', () => {
    const originals = klass(43, unnumbered);
    const r = toChunks(originals);
    const edits = r.chunks.flatMap(parseChunk);
    expect(edits).toHaveLength(43);
    expect(reconcile(originals, edits)).toEqual({ updated: [], added: [], removed: [] });
  });

  it('renders 54 numbered children, parses them back, and changes nothing', () => {
    const originals = klass(54, numbered);
    const r = toChunks(originals);
    const edits = r.chunks.flatMap(parseChunk);
    expect(edits).toHaveLength(54);
    expect(reconcile(originals, edits)).toEqual({ updated: [], added: [], removed: [] });
  });

  it('round-trips a mixed class of 43 where a third of the rolls are unreadable', () => {
    const originals = Array.from({ length: 43 }, (_, i) => (i % 3 === 0
      ? unnumbered(i, `${NAMES[i % NAMES.length]} ${i}`, FATHERS[i % FATHERS.length])
      : numbered(i, `${NAMES[i % NAMES.length]} ${i}`, FATHERS[i % FATHERS.length])));
    const r = toChunks(originals);
    const edits = r.chunks.flatMap(parseChunk);
    expect(edits).toHaveLength(43);
    expect(reconcile(originals, edits)).toEqual({ updated: [], added: [], removed: [] });
  });

  it('carries an edit made inside a rebalanced box to the right child', () => {
    const originals = klass(54, numbered);
    const r = toChunks(originals);
    // Correct the last child in the last used box — the one a greedy pack would
    // have buried at the bottom of box 1.
    const boxes = r.chunks.slice();
    const last = r.visible.lastIndexOf(true);
    const lines = boxes[last].split('\n');
    const target = lines[lines.length - 1];
    const roll = target.split('.')[0];
    lines[lines.length - 1] = `${roll}. Corrected Name / Corrected Father`;
    boxes[last] = lines.join('\n');
    const out = reconcile(originals, boxes.flatMap(parseChunk));
    expect(out.updated).toEqual([
      { id: `uuid-${Number(roll) - 1}`, student_name: 'Corrected Name', father_name: 'Corrected Father' },
    ]);
    expect(out.added).toHaveLength(0);
    expect(out.removed).toHaveLength(0);
  });

  it('lets a coach supply a real roll over a prefix-less line without splitting the child', () => {
    const originals = klass(6, unnumbered);
    const lines = toChunks(originals).chunks.filter(Boolean).join('\n').split('\n');
    lines[5] = `36. ${lines[5]}`;
    const out = pairMoves(reconcile(originals, parseChunk(lines.join('\n'))));
    expect(out.moved).toEqual([{ id: 'uuid-5', roll: '36' }]);
    expect(out.added).toHaveLength(0);
    expect(out.removed).toHaveLength(0);
    expect(out.updated).toHaveLength(0);
  });

  /**
   * CHARACTERISATION, NOT AN ENDORSEMENT — bd-a05gc.
   *
   * reconcile() matches roll-less lines to roll-less children by position within
   * the roll-less subset, which is the only locator either side has for those
   * rows. On a register with SOME roll-less children that is fine. On one with NO
   * roll column at all it means the whole class is positional, so a single
   * inserted or deleted line shifts every child below it.
   *
   * Verified byte-identical on origin/develop with the "?." prefix in place, so
   * this is pre-existing and not caused by dropping the prefix. Dropping the
   * prefix reduces how often a coach is provoked into deleting a line; it does not
   * fix this. Pinned here so the fix for bd-a05gc trips a test.
   */
  it('still shifts identities when a line is deleted from an all-roll-less class', () => {
    const originals = klass(6, unnumbered);
    const lines = toChunks(originals).chunks.filter(Boolean).join('\n').split('\n');
    lines.splice(2, 1);
    const out = reconcile(originals, parseChunk(lines.join('\n')));
    expect(out.updated).toHaveLength(3);              // should be 0
    expect(out.removed.map((s) => s.id)).toEqual(['uuid-5']); // should be uuid-2
  });
});

// ---------------------------------------------------------------------------
// Urdu — Nastaliq is multi-byte, and every cap here is a code-point cap
// ---------------------------------------------------------------------------
describe('Urdu names are measured in code points, not bytes', () => {
  const URDU = ['محمد عبد الرحمن',
    'سیدہ عائشہ بی بی',
    'حبیب اللہ خان'];
  const urduClass = (n, make) => Array.from({ length: n }, (_, i) =>
    make(i, `${URDU[i % URDU.length]} ${i}`, URDU[(i + 1) % URDU.length]));

  it('keeps every box inside the cap when measured in code points', () => {
    const r = toChunks(urduClass(54, numbered));
    r.chunks.filter(Boolean).forEach((c) => {
      expect(cp(c)).toBeLessThanOrEqual(CHUNK_CHAR_CAP);
      expect(Buffer.byteLength(c, 'utf8')).toBeGreaterThan(cp(c)); // it really is multi-byte
    });
    usedFills(r).forEach((f) => expect(f).toBeLessThanOrEqual(FILL_TARGET));
    expect(r.overflow).toBe(0);
  });

  it('round-trips 54 long Urdu names with no roll column, unchanged', () => {
    const originals = urduClass(54, unnumbered);
    const r = toChunks(originals);
    const lines = r.chunks.filter(Boolean).join('\n').split('\n');
    expect(lines).toHaveLength(54);
    for (const line of lines) expect(line.startsWith('?')).toBe(false);
    expect(reconcile(originals, r.chunks.flatMap(parseChunk)))
      .toEqual({ updated: [], added: [], removed: [] });
  });

  it('keeps labels and helpers inside their code-point caps for Urdu classes', () => {
    const r = toChunks(urduClass(54, unnumbered));
    r.labels.forEach((l) => expect(cp(l)).toBeLessThanOrEqual(20));
    r.helpers.forEach((h) => expect(cp(h)).toBeLessThanOrEqual(HELPER_CAP));
  });
});
