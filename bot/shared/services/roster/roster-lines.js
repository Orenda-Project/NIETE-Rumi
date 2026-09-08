'use strict';
/**
 * /roster — the bridge between a stored roster and the editable TextArea boxes on
 * the REVIEW screen.
 *
 * WHY THIS FILE EXISTS. WhatsApp Flows have no repeater, no data table and no
 * inline row editing — verified against Meta's component reference and against
 * every component Meta has accepted from this deployment. So the only way to let a
 * coach see and correct a whole class in one screen is a prefilled TextArea, which
 * is what the attendance setup Flow already does for a typed roster. Meta caps a
 * TextArea at 600 characters, so the list is split across six boxes (~3,600
 * characters, roughly 100 students with father names). Four boxes overflowed a
 * 60-student class in test, which is how the number six was chosen.
 *
 * IDENTITY. Every line carries its roll number as a prefix and reconcile() matches
 * on THAT, never on line position. Registers are rewritten by hand each month and
 * renumber as children are admitted and struck off — measured on real registers,
 * the same three girls sat at rolls 23/24/25 one month and 26/27/28 the next. So
 * position is not identity, and neither is the roll number itself: it is only a
 * locator for matching an edited line back to a students.id we already hold.
 *
 * A BOX IS PACKED TO A TARGET, NOT TO THE PLATFORM CEILING. The greedy pack this
 * file shipped with filled box 1 to CHUNK_CHAR_CAP before opening box 2, and
 * CHUNK_CHAR_CAP is Meta's HARD limit — so a full box had exactly zero room for
 * the edit the screen exists to collect. Field report 2026-09-08: a 54-child
 * class rendered 591/600, 599/600 and 336/600 with three boxes empty below it,
 * and the coach could not finish typing a father's name. Two children in that
 * class are in the database with the name cut off mid-word. So the packer now
 * aims at FILL_TARGET, spreads the class evenly across the boxes it opens, and
 * only falls back to the hard cap when the target genuinely will not fit —
 * headroom is a preference, a child reaching the screen is not.
 *
 * AN UNREADABLE ROLL IS RENDERED AS `?`, NOT AS A NUMBER. On 2026-08-30 three
 * children whose rolls sat behind a drawing came back from the model as 10/11/12
 * for a page that numbers them 35/36/37. The extractor abstains now, and the null
 * it produces has to reach the coach's eyes as a null: printing the ordinal in its
 * place would recreate the same bug one layer down, with the coach reading OUR
 * counter as a roll number read off the register. A `?` line is editable — typing
 * the real roll over it is how the coach supplies what the camera could not see —
 * and reconcile() matches those lines back in render order, so a correction on one
 * lands on the child it was rendered for instead of being filed as a new admission.
 *
 * ...BUT ONLY WHERE IT MEANS SOMETHING. `?` says "this child's roll could not be
 * read", which is information only next to siblings whose rolls could. On a
 * register with no roll column at all every one of 43 lines got a `?`, it told
 * the coach nothing, and coaches read it as breakage and deleted children (field
 * report 2026-09-07). So the prefix is dropped entirely when NO child in the list
 * carries a roll, and kept whenever any child does. This is a rendering decision
 * only: parseChunk's prefix match is optional, so a bare line and a `?.` line both
 * read back as roll null, and reconcile() matches both in render order.
 */

// Meta's hard cap on a TextArea value. Not a default — the ceiling.
const CHUNK_CHAR_CAP = 600;
// What a box is actually FILLED to, so the coach can still type in it. Measured
// against ICT production 2026-09-08 (15,532 enrolled children, 470 classes): a
// rendered line is 16 code points at the median, 31 at p95, 36 at p99. 120 code
// points of headroom is therefore three whole extra children at p99, or four at
// p95 — enough to lengthen several names AND add a child the camera missed.
const EDIT_HEADROOM = 120;
const FILL_TARGET = CHUNK_CHAR_CAP - EDIT_HEADROOM;
// Six boxes costs 6 of the 50 components a screen allows. The cost of one more is
// trivial; the cost of silently dropping a child off the end is not.
const MAX_BOXES = 6;
// Meta caps a TextArea label at 20 characters ("Students 100-115" is 16).
const LABEL_CAP = 20;
// Meta caps helper-text at 80 characters and a TextBody at 4096. 4000 leaves room
// for the tail line that says what did not fit.
const HELPER_CAP = 80;
const LIST_CHAR_CAP = 4000;
const SEP = ' / ';
// What a line shows where the register's own roll number could not be read.
const UNKNOWN_ROLL = '?';

/** The key a line is matched back on. Falls back to the ordinal when a register carries no roll. */
function keyOf(student, index) {
  const roll = student && student.roll_number;
  return roll === null || roll === undefined || String(roll).trim() === ''
    ? String(index + 1)
    : String(roll).trim();
}

/** True when this row carries no roll number we actually read off the page. */
function rollMissing(student) {
  const roll = student && student.roll_number;
  return roll === null || roll === undefined || String(roll).trim() === '';
}

/** True when at least one child in this list carries a roll we read off the page. */
function listHasRolls(students) {
  return (students || []).some((s) => !rollMissing(s));
}

/**
 * One line.
 *
 * `showRolls` is a property of the LIST, not of the child: it is false only when
 * no child in the list has a roll, and then the line carries no prefix at all.
 * It defaults to true so a lone call still renders `?.`, which is what a mixed
 * page shows.
 */
function renderLine(student, index, showRolls = true) {
  const name = (student.student_name || '').trim();
  const father = (student.father_name || '').trim();
  const body = father ? name + SEP + father : name;
  if (!showRolls) return body;
  const prefix = rollMissing(student) ? UNKNOWN_ROLL : keyOf(student, index);
  return `${prefix}. ${body}`;
}

/**
 * The whole class, once, as one readable block for the TextBody above the boxes.
 *
 * A TextArea has no height, rows or size property and no scrollbar affordance —
 * Meta gives one small well whatever you ask for. A coach reading a 40-name class
 * through it saw four names and reasonably concluded that was all we had extracted
 * (field test, 2026-08-30). So the list is read here, where it flows down the
 * screen, and edited in the boxes below.
 */
function renderList(students, cap = LIST_CHAR_CAP) {
  const list = students || [];
  if (!list.length) return '';

  const showRolls = listHasRolls(list);
  const lines = list.map((s, i) => renderLine(s, i, showRolls));
  const whole = lines.join('\n');
  if (whole.length <= cap) return whole;

  // Truncating in silence is the bug this function exists to fix, so the tail
  // says how many are missing and where to find them.
  let out = '';
  let shown = 0;
  for (const line of lines) {
    const tail = `\n… ${list.length - shown} more below in the edit boxes.`;
    if ((out ? out.length + 1 : 0) + line.length + tail.length > cap) break;
    out = out ? `${out}\n${line}` : line;
    shown += 1;
  }
  return `${out}\n… ${list.length - shown} more below in the edit boxes.`;
}

/**
 * Pack lines into at most `maxBoxes` contiguous boxes, none over `limit`.
 *
 * Contiguous on purpose: the boxes are read top to bottom as one list, so a box
 * holds a SLICE of the roster in roster order. Returns `full` when it ran out of
 * boxes with lines still to place.
 *
 * A single line longer than `limit` gets a box to itself rather than opening an
 * empty one — the version before this returned an empty visible box with a label
 * in that case. (A line longer than CHUNK_CHAR_CAP would still be unrenderable;
 * the longest line in ICT production on 2026-09-08 is 216 code points.)
 */
function packLines(lines, limit, maxBoxes) {
  const chunks = [];
  const bounds = [];
  let cur = '';
  let curFirst = 1;
  let placed = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const next = cur ? `${cur}\n${line}` : line;

    if (cur && next.length > limit) {
      if (chunks.length + 1 >= maxBoxes) {
        // The last box is full and there is still more to place. Stop here and
        // report the remainder rather than truncating in silence.
        chunks.push(cur);
        bounds.push([curFirst, placed]);
        return { chunks, bounds, placed, full: true };
      }
      chunks.push(cur);
      bounds.push([curFirst, placed]);
      cur = line;
      curFirst = placed + 1;
    } else {
      cur = next;
    }
    placed += 1;
  }

  if (cur) {
    chunks.push(cur);
    bounds.push([curFirst, placed]);
  }
  return { chunks, bounds, placed, full: false };
}

/**
 * Choose the packing: as few boxes as the target allows, then evened out.
 *
 * 1. Pack at FILL_TARGET. If everyone fits, that box count is the fewest boxes
 *    that can hold the class with headroom — greedy is optimal for a contiguous
 *    split. Then search downward for the smallest per-box limit that still needs
 *    no more boxes than that, which is what turns 480/480/480/86 into
 *    405/405/405/347. The coach gets the same number of boxes to scroll and the
 *    same amount of room in each.
 * 2. If the class does not fit at the target, pack at the hard cap instead. That
 *    is exactly the behaviour that shipped, so a lower target can never drop a
 *    child that fits today — proven in tests/roster/roster-boxes-and-rolls.test.js.
 */
function packToBoxes(lines) {
  const soft = packLines(lines, FILL_TARGET, MAX_BOXES);
  if (soft.placed === lines.length) {
    const boxes = soft.chunks.length;
    const longest = lines.reduce((m, l) => Math.max(m, l.length), 1);
    let lo = longest;
    let hi = FILL_TARGET;
    let best = soft;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const t = packLines(lines, mid, MAX_BOXES);
      if (t.placed === lines.length && t.chunks.length <= boxes) {
        best = t;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    return { chunks: best.chunks, bounds: best.bounds, overflow: 0 };
  }

  const hard = packLines(lines, CHUNK_CHAR_CAP, MAX_BOXES);
  return {
    chunks: hard.chunks,
    bounds: hard.bounds,
    overflow: Math.max(0, lines.length - hard.placed),
  };
}

/**
 * Render students into the six editable boxes.
 *
 * @param {Array<{id:string, roll_number?:string, student_name:string, father_name?:string}>} students
 * @returns {{chunks:string[], labels:string[], visible:boolean[], overflow:number}}
 *   chunks/labels/helpers/visible are always MAX_BOXES long — the screen is static
 *   once published, so unused boxes are hidden, never removed. `overflow` is the
 *   number of students that did not fit and must be reported rather than dropped.
 */
function toChunks(students) {
  const list = students || [];
  const showRolls = listHasRolls(list);
  const lines = list.map((s, i) => renderLine(s, i, showRolls));
  const { chunks, bounds, overflow } = packToBoxes(lines);

  const labels = [];
  const helpers = [];
  const visible = [];
  const total = list.length;
  for (let b = 0; b < MAX_BOXES; b += 1) {
    const has = b < chunks.length && chunks[b].length > 0;
    visible.push(has);
    const label = has ? `Students ${bounds[b][0]}-${bounds[b][1]}` : `Students ${b + 1}`;
    labels.push(label.length > LABEL_CAP ? label.slice(0, LABEL_CAP) : label);
    // The label is capped at 20 characters, which is not enough room to say that a
    // box holds a SLICE. Without that, a coach reads the first box as the class.
    // When the page carried no roll column the helper says so, because the lines
    // above it no longer start with a number and that must not read as a fault.
    const help = has
      ? `Students ${bounds[b][0]}-${bounds[b][1]} of ${total}. One per line`
        + `${showRolls ? '.' : ', no roll numbers.'}`
      : '';
    helpers.push(help.length > HELPER_CAP ? help.slice(0, HELPER_CAP) : help);
  }
  while (chunks.length < MAX_BOXES) chunks.push('');

  return { chunks, labels, helpers, visible, overflow };
}

/**
 * Read one box back. Tolerates what a coach actually does to a prefilled list:
 * deletes the numbering, pastes from elsewhere, leaves blank lines, writes Urdu.
 *
 * @param {string} raw
 * @returns {Array<{roll:string|null, student_name:string, father_name:string|null}>}
 */
function parseChunk(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const out = [];

  for (const rawLine of raw.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;

    let roll = null;
    // Leading "14." / "14)" / "14 -", or "?." for a roll the camera could not read.
    // A separator is required after the token so a name that legitimately starts
    // with a number survives.
    const m = line.match(/^(\d{1,3}|\?)\s*[.)\-:]\s*(.*)$/);
    if (m) {
      roll = m[1] === UNKNOWN_ROLL ? null : m[1];
      line = m[2].trim();
    }
    if (!line) continue;

    const parts = line.split('/');
    const studentName = (parts[0] || '').trim();
    const fatherName = parts.length > 1 ? (parts.slice(1).join('/').trim() || null) : null;
    if (!studentName) continue;

    out.push({ roll, student_name: studentName, father_name: fatherName });
  }
  return out;
}

const same = (a, b) => (a || '').trim() === (b || '').trim();

/**
 * Diff the coach's edits against what we rendered for them.
 *
 * Matching is by roll key. A line whose key we do not recognise is an ADDITION,
 * never an edit — guessing would rename a child, and a class with four children
 * sharing a given name is the normal case here, not an edge case. A key we sent
 * that does not come back is a REMOVAL.
 *
 * The one exception is a line with NO roll at all. Those come in two kinds and
 * they have to be told apart: a `?` line is one WE rendered for a child whose roll
 * the camera could not read, and a bare line is one the coach typed. The `?` lines
 * are consumed in render order against the roll-less children we sent, so a
 * correction on one lands on the child it belongs to; anything left over after that
 * queue is exhausted is a genuine addition. Position is used here and nowhere else,
 * and only within the roll-less subset, because for those rows it is the only
 * locator either side has.
 *
 * @returns {{updated:Array<{id:string,student_name:string,father_name:string|null}>,
 *            added:Array<{student_name:string,father_name:string|null}>,
 *            removed:Array<object>}}
 */
function reconcile(originals, edits) {
  const list = originals || [];
  const byKey = new Map();
  list.forEach((s, i) => { if (!rollMissing(s)) byKey.set(keyOf(s, i), s); });

  // The roll-less children we rendered, in the order we rendered them.
  const unnumbered = list.filter(rollMissing);
  let nextUnnumbered = 0;

  const updated = [];
  const added = [];
  const seen = new Set();

  for (const e of edits || []) {
    let hit = null;
    if (e.roll !== null && byKey.has(e.roll)) {
      hit = byKey.get(e.roll);
      seen.add(e.roll);
    } else if (e.roll === null && nextUnnumbered < unnumbered.length) {
      hit = unnumbered[nextUnnumbered];
      nextUnnumbered += 1;
      seen.add(hit);
    }

    if (!hit) {
      // Keep the roll the coach typed: in edit mode an add becomes a database
      // row, and a roll-less add cannot be told apart from a move (see pairMoves).
      added.push({ roll: e.roll, student_name: e.student_name, father_name: e.father_name });
      continue;
    }
    if (!same(hit.student_name, e.student_name) || !same(hit.father_name, e.father_name)) {
      updated.push({ id: hit.id, student_name: e.student_name, father_name: e.father_name });
    }
  }

  const removed = [];
  byKey.forEach((s, k) => { if (!seen.has(k)) removed.push(s); });
  unnumbered.forEach((s) => { if (!seen.has(s)) removed.push(s); });

  return { updated, added, removed };
}

/**
 * A roll correction must stay the SAME child. reconcile() keys on the roll, so
 * "Ayesha moves from roll 1 to roll 7" comes out as removed(Ayesha@1) +
 * added(Ayesha@7) — and if those became database actions, the child would be
 * closed and re-created: her identity split, her attendance stranded.
 *
 * This pairs an added row with a removed row bearing the SAME name (and, when
 * both carry one, the same father) into a move of the existing child. The name
 * match is safe here precisely because it is within one human-confirmed edit of
 * one class — never the global fuzzy matching the architecture forbids.
 */
function pairMoves(diff) {
  const norm = (v) => String(v || '').trim().toLowerCase();
  const moved = [];
  const added = [];
  const removedLeft = [...(diff.removed || [])];

  for (const a of diff.added || []) {
    const i = removedLeft.findIndex((r) => norm(r.student_name) === norm(a.student_name)
      && (!r.father_name || !a.father_name || norm(r.father_name) === norm(a.father_name)));
    if (i >= 0 && a.roll !== null && a.roll !== undefined) {
      moved.push({ id: removedLeft[i].id, roll: a.roll });
      removedLeft.splice(i, 1);
    } else {
      added.push(a);
    }
  }
  return { updated: diff.updated || [], moved, added, removed: removedLeft };
}

module.exports = {
  CHUNK_CHAR_CAP,
  FILL_TARGET,
  EDIT_HEADROOM,
  MAX_BOXES,
  LABEL_CAP,
  HELPER_CAP,
  LIST_CHAR_CAP,
  UNKNOWN_ROLL,
  keyOf,
  rollMissing,
  listHasRolls,
  renderLine,
  renderList,
  toChunks,
  parseChunk,
  reconcile,
  pairMoves,
};
