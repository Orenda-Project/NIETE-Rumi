'use strict';
/**
 * A ROLL-LESS CHILD STILL HAS AN IDENTITY — bd-a05gc.
 *
 * reconcile() matched a roll-less edited line to a roll-less original BY POSITION
 * within the roll-less subset. On a register with SOME roll-less rows that is a
 * reasonable last resort. On a register with NO roll column — common, and the
 * whole reason bd-o91mx exists — every child is roll-less, so the entire class is
 * matched by position and one deleted line shifts every child below it: each
 * survivor is saved under the NEXT child's name and the LAST child, not the
 * deleted one, is the one struck off.
 *
 * That is a silent data corruption on a live production path: saveRosterEdits()
 * feeds diff.updated straight into roster_apply_edits(p_updates) and diff.removed
 * into p_removes, which CLOSES an enrolment.
 *
 * These tests execute reconcile()/pairMoves() and saveRosterEdits() directly. The
 * only thing mocked is the network boundary — ClassService, the roster bucket and
 * the Supabase client.
 */

const {
  toChunks,
  parseChunk,
  reconcile,
  pairMoves,
} = require('../../bot/shared/services/roster/roster-lines');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NAMES = ['Ayesha', 'Bilal', 'Chand Bibi', 'Danish', 'Eman', 'Farhan', 'Ghazala', 'Hamza'];
const FATHERS = ['Iqbal', 'Javed', 'Kamran', 'Latif', 'Mansoor', 'Nadeem', 'Owais', 'Pervez'];

/** A child with NO roll number — what a register with no roll column produces. */
const rollless = (i) => ({
  id: `uuid-${i}`,
  roll_number: null,
  student_name: `${NAMES[i % NAMES.length]} ${i}`,
  father_name: FATHERS[i % FATHERS.length],
});

/** A child with a roll read off the page. */
const numbered = (i) => ({ ...rollless(i), roll_number: String(i + 1) });

const klass = (n, make) => Array.from({ length: n }, (_, i) => make(i));

/** Render a class the way the REVIEW screen does, and read it back as lines. */
const renderedLines = (students) =>
  toChunks(students).chunks.filter(Boolean).join('\n').split('\n');

const parseAll = (lines) => parseChunk(lines.join('\n'));

const cp = (s) => Array.from(String(s)).length;

// ---------------------------------------------------------------------------
// 1. THE HEADLINE — a deletion must remove the deleted child and nobody else
// ---------------------------------------------------------------------------
describe('an all-roll-less class survives a deletion', () => {
  it('keeps every remaining child under her OWN name and removes exactly the deleted one', () => {
    const originals = klass(8, rollless);
    const lines = renderedLines(originals);
    expect(lines).toHaveLength(8);

    // The coach deletes line 5 — the fifth child, uuid-4.
    const deleted = originals[4];
    lines.splice(4, 1);

    const out = reconcile(originals, parseAll(lines));

    // Nobody is renamed. Position shifting shows up here as 3 bogus updates.
    expect(out.updated).toEqual([]);
    // The child struck off is the one the coach struck off.
    expect(out.removed.map((s) => s.id)).toEqual([deleted.id]);
    expect(out.added).toEqual([]);
  });

  it('names the deleted child, not the last child, however long the class is', () => {
    const originals = klass(8, rollless);
    for (let cut = 0; cut < 8; cut += 1) {
      const lines = renderedLines(originals);
      lines.splice(cut, 1);
      const out = reconcile(originals, parseAll(lines));
      expect(out.removed.map((s) => s.id)).toEqual([`uuid-${cut}`]);
      expect(out.updated).toEqual([]);
      expect(out.added).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. The other four edit shapes
// ---------------------------------------------------------------------------
describe('the edit shapes a coach actually performs', () => {
  const originals = klass(8, rollless);

  it('an INSERTION in the middle adds one child and touches nobody else', () => {
    const lines = renderedLines(originals);
    lines.splice(3, 0, 'Zainab Noor / Qasim');
    const out = reconcile(originals, parseAll(lines));
    expect(out.updated).toEqual([]);
    expect(out.removed).toEqual([]);
    expect(out.added).toEqual([
      { roll: null, student_name: 'Zainab Noor', father_name: 'Qasim' },
    ]);
  });

  it('a RENAME updates the child it was typed over and nobody else', () => {
    const lines = renderedLines(originals);
    lines[3] = 'Danyal 3 / Latif';
    const out = reconcile(originals, parseAll(lines));
    expect(out.updated).toEqual([
      { id: 'uuid-3', student_name: 'Danyal 3', father_name: 'Latif' },
    ]);
    expect(out.added).toEqual([]);
    expect(out.removed).toEqual([]);
  });

  it('a REORDER is not an edit at all', () => {
    const lines = renderedLines(originals);
    const [a, b] = [lines[1], lines[5]];
    lines[1] = b; lines[5] = a;
    const out = reconcile(originals, parseAll(lines));
    expect(out.updated).toEqual([]);
    expect(out.added).toEqual([]);
    expect(out.removed).toEqual([]);
  });

  it('a RENAME AND A DELETION in the same save resolve to one of each', () => {
    const lines = renderedLines(originals);
    // Delete child 3 (uuid-2) and fix the spelling of child 4 (uuid-3), which
    // sits immediately below her — the pair position cannot tell apart.
    lines[3] = 'Daanish 3 / Latif';
    lines.splice(2, 1);
    const out = reconcile(originals, parseAll(lines));
    expect(out.updated).toEqual([
      { id: 'uuid-3', student_name: 'Daanish 3', father_name: 'Latif' },
    ]);
    expect(out.removed.map((s) => s.id)).toEqual(['uuid-2']);
    expect(out.added).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. Two children with the same name — this deployment has already hit it
// ---------------------------------------------------------------------------
describe('two roll-less children sharing a name', () => {
  const twins = [
    { id: 'a', roll_number: null, student_name: 'Abdul Rehman', father_name: 'Sami' },
    { id: 'b', roll_number: null, student_name: 'Abdul Rehman', father_name: 'Sami' },
    { id: 'c', roll_number: null, student_name: 'Hooria', father_name: 'Kamran' },
  ];

  it('round-trips to nothing when the coach changes nothing', () => {
    const out = reconcile(twins, parseAll(renderedLines(twins)));
    expect(out.updated).toEqual([]);
    expect(out.added).toEqual([]);
    expect(out.removed).toEqual([]);
  });

  it('removes exactly one of them when the coach deletes one line', () => {
    const lines = renderedLines(twins);
    lines.splice(0, 1);
    const out = reconcile(twins, parseAll(lines));
    expect(out.updated).toEqual([]);
    expect(out.added).toEqual([]);
    expect(out.removed).toHaveLength(1);
    expect(['a', 'b']).toContain(out.removed[0].id);
  });

  it('picks the right one by father when the names collide and the fathers do not', () => {
    const pair = [
      { id: 'a', roll_number: null, student_name: 'Abdul Rehman', father_name: 'Sami' },
      { id: 'b', roll_number: null, student_name: 'Abdul Rehman', father_name: 'Karim' },
      { id: 'c', roll_number: null, student_name: 'Hooria', father_name: 'Kamran' },
    ];
    const lines = renderedLines(pair);
    lines.splice(0, 1); // strike off Sami's son
    const out = reconcile(pair, parseAll(lines));
    expect(out.removed.map((s) => s.id)).toEqual(['a']);
    expect(out.updated).toEqual([]);
  });

  it('never silently drops a child it cannot match — it reports her instead', () => {
    // Two adjacent children, one edited line between the same neighbours, and no
    // name close enough to either. Guessing would rename one and strike off the
    // other; keeping both and saying so is the only safe answer.
    const originals = [
      { id: 'k1', roll_number: null, student_name: 'Ayesha', father_name: 'Iqbal' },
      { id: 'k2', roll_number: null, student_name: 'Bilal', father_name: 'Javed' },
      { id: 'k3', roll_number: null, student_name: 'Chand Bibi', father_name: 'Kamran' },
      { id: 'k4', roll_number: null, student_name: 'Danish', father_name: 'Latif' },
    ];
    const out = reconcile(originals, parseAll([
      'Ayesha / Iqbal',
      'Zubaida Khatoon / Yousaf',
      'Danish / Latif',
    ]));
    expect(out.removed).toEqual([]);
    expect(out.unresolved.map((s) => s.id)).toEqual(['k2', 'k3']);
    expect(out.added).toEqual([
      { roll: null, student_name: 'Zubaida Khatoon', father_name: 'Yousaf' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 4. Round trip is a no-op — the property that must hold for every class shape
// ---------------------------------------------------------------------------
describe('render → parse → reconcile is a no-op when the coach edits nothing', () => {
  const URDU = ['محمد عبد الرحمٰن', 'سیدہ عائشہ بی بی', 'حبیب اللہ خان', 'مسمات زبیدہ خاتون'];
  const urdu = (i) => ({
    id: `u-${i}`,
    roll_number: null,
    student_name: `${URDU[i % URDU.length]} ${i}`,
    father_name: URDU[(i + 1) % URDU.length],
  });
  const urduNumbered = (i) => ({ ...urdu(i), roll_number: String(i + 1) });
  const mixed = (i) => (i % 3 === 0 ? rollless(i) : numbered(i));
  const urduMixed = (i) => (i % 3 === 0 ? urdu(i) : urduNumbered(i));

  const shapes = [
    ['every child has a roll', numbered, 54],
    ['no child has a roll', rollless, 54],
    ['a third of the rolls are unreadable', mixed, 54],
    ['long Urdu Nastaliq names, no roll column', urdu, 40],
    ['long Urdu Nastaliq names, every roll read', urduNumbered, 40],
    ['long Urdu Nastaliq names, mixed rolls', urduMixed, 40],
  ];

  shapes.forEach(([what, make, n]) => {
    it(`is a no-op when ${what}`, () => {
      const originals = klass(n, make);
      const lines = renderedLines(originals);
      expect(lines).toHaveLength(n);
      const out = reconcile(originals, parseAll(lines));
      expect(out.updated).toEqual([]);
      expect(out.added).toEqual([]);
      expect(out.removed).toEqual([]);
      expect(out.unresolved).toEqual([]);
    });
  });

  it('measures Urdu names in code points, not bytes, at every cap', () => {
    const originals = klass(40, urdu);
    const r = toChunks(originals);
    r.chunks.filter(Boolean).forEach((c) => {
      expect(cp(c)).toBeLessThanOrEqual(600);
      expect(Buffer.byteLength(c, 'utf8')).toBeGreaterThan(cp(c));
    });
    r.labels.forEach((l) => expect(cp(l)).toBeLessThanOrEqual(20));
    r.helpers.forEach((h) => expect(cp(h)).toBeLessThanOrEqual(80));
  });

  it('survives a deletion from a class of long Urdu names with no roll column', () => {
    const originals = klass(40, urdu);
    const lines = renderedLines(originals);
    lines.splice(17, 1);
    const out = reconcile(originals, parseAll(lines));
    expect(out.updated).toEqual([]);
    expect(out.removed.map((s) => s.id)).toEqual(['u-17']);
  });
});

// ---------------------------------------------------------------------------
// 5. The numbered contract does not move
// ---------------------------------------------------------------------------
describe('a roll number is still the strongest locator there is', () => {
  it('a roll correction is still one child MOVING, not a delete plus a create', () => {
    const DB = [
      { id: 'st-1', roll_number: 1, student_name: 'Ayesha', father_name: 'Bilal' },
      { id: 'st-2', roll_number: 2, student_name: 'Minahil', father_name: 'Asif' },
    ];
    const paired = pairMoves(reconcile(DB, [
      { roll: '7', student_name: 'Ayesha', father_name: 'Bilal' },
      { roll: '2', student_name: 'Minahil', father_name: 'Asif' },
    ]));
    expect(paired.moved).toEqual([{ id: 'st-1', roll: '7' }]);
    expect(paired.added).toEqual([]);
    expect(paired.removed).toEqual([]);
  });

  it('typing a real roll over a roll-less line still moves that child', () => {
    const originals = klass(6, rollless);
    const lines = renderedLines(originals);
    lines[5] = `36. ${lines[5]}`;
    const paired = pairMoves(reconcile(originals, parseAll(lines)));
    expect(paired.moved).toEqual([{ id: 'uuid-5', roll: '36' }]);
    expect(paired.updated).toEqual([]);
    expect(paired.added).toEqual([]);
    expect(paired.removed).toEqual([]);
  });

  it('typing a real roll over line 2 of a long roll-less class moves ONE child', () => {
    const originals = klass(43, rollless);
    const lines = renderedLines(originals);
    lines[1] = `36. ${lines[1]}`;
    const paired = pairMoves(reconcile(originals, parseAll(lines)));
    expect(paired.moved).toEqual([{ id: 'uuid-1', roll: '36' }]);
    expect(paired.updated).toEqual([]);
    expect(paired.added).toEqual([]);
    expect(paired.removed).toEqual([]);
  });
});
