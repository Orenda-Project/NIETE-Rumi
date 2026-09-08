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
 * AND POSITION IS NOT IDENTITY FOR A ROLL-LESS CHILD EITHER (bd-a05gc). Until
 * 2026-09-08 a line with no roll was matched to a roll-less child BY POSITION
 * within the roll-less subset. Where two or three rows were roll-less that was a
 * reasonable last resort. On a register with NO roll column — common, and the
 * whole reason bd-o91mx exists — EVERY child is roll-less, so the whole class was
 * positional: deleting one line shifted the pairing by one for every child below
 * it, each survivor was saved under the NEXT child's name, and the LAST child was
 * struck off instead of the one the coach deleted. saveRosterEdits() feeds that
 * diff straight into roster_apply_edits(), so it was a live corruption, not a
 * display fault. The name a coach can read on the page is now the locator for
 * those rows, and position is used only to break a tie between two lines that sit
 * between the SAME two children we already matched.
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
 * and reconcile() matches those lines back by the NAME on them, so a correction on
 * one lands on the child it was rendered for instead of being filed as a new
 * admission.
 *
 * ...BUT ONLY WHERE IT MEANS SOMETHING. `?` says "this child's roll could not be
 * read", which is information only next to siblings whose rolls could. On a
 * register with no roll column at all every one of 43 lines got a `?`, it told
 * the coach nothing, and coaches read it as breakage and deleted children (field
 * report 2026-09-07). So the prefix is dropped entirely when NO child in the list
 * carries a roll, and kept whenever any child does. This is a rendering decision
 * only: parseChunk's prefix match is optional, so a bare line and a `?.` line both
 * read back as roll null, and reconcile() matches both on the name they carry.
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

// How alike two lines must read before a difference between them counts as a
// spelling correction rather than a different child. Measured in code points over
// "name / father", so Nastaliq is compared the way it is displayed.
const NAME_SIMILARITY_FLOOR = 0.72;
// Similarity is O(n*m) over a gap. A gap this size means the coach retyped the
// class, and there is nothing left to disambiguate anyway — fall through to the
// count rules rather than burn the request.
const SIMILARITY_MAX_GAP = 40;

/** Compare names the way a person reads them: trimmed, case-folded, spaces collapsed. */
function normName(v) {
  return String(v === null || v === undefined ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Name AND father — the strongest thing an edited line carries when it has no roll. */
function identityKey(name, father) {
  return `${normName(name)}\u0000${normName(father)}`;
}

/** The same pair as one readable string, for measuring how alike two lines are. */
function displayKey(name, father) {
  return normName(father) ? `${normName(name)} / ${normName(father)}` : normName(name);
}

/** Levenshtein distance over CODE POINTS — a Nastaliq name is not a byte string. */
function editDistance(a, b) {
  const s = Array.from(a);
  const t = Array.from(b);
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  let prev = new Array(t.length + 1);
  for (let j = 0; j <= t.length; j += 1) prev[j] = j;
  for (let i = 1; i <= s.length; i += 1) {
    const cur = new Array(t.length + 1);
    cur[0] = i;
    for (let j = 1; j <= t.length; j += 1) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[t.length];
}

/** 1 for the same string, 0 for nothing in common. */
function similarity(a, b) {
  if (a === b) return 1;
  const max = Math.max(Array.from(a).length, Array.from(b).length);
  if (!max) return 1;
  return 1 - editDistance(a, b) / max;
}

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
 * FOUR PASSES, STRONGEST LOCATOR FIRST. Each pass claims pairs; later passes only
 * see what is left.
 *
 *  1. THE ROLL. A roll we rendered that comes back is the same child, wherever
 *     her line now sits. Unchanged, and still the only thing that can express a
 *     roll correction (which leaves a remove+add for pairMoves to turn into a
 *     move).
 *  2. NAME AND FATHER, EXACTLY. Within the roll-less lane, group both sides by
 *     the normalised "name + father" and pair them off. No uniqueness test is
 *     needed here and none is wanted: if two children read identically then the
 *     rows are interchangeable, so pairing either way writes the same values —
 *     which is exactly what makes an untouched class of two Abdul Rehmans round
 *     trip to nothing.
 *  3. NAME ONLY, WHEN IT IS THE ONLY ONE. A coach who fixes the father's spelling
 *     breaks pass 2. Pairing on the given name alone is safe ONLY when exactly one
 *     unmatched child and exactly one unmatched line carry it — two Abdul Rehmans
 *     with different fathers must never be resolved this way, so they are not.
 *  4. THE GAP BETWEEN TWO CHILDREN WE ALREADY MATCHED. Everything still unmatched
 *     is bucketed between consecutive matched pairs, and resolved inside that
 *     bucket only:
 *       - children with no lines left  -> REMOVED (the coach deleted them),
 *       - lines with no children left  -> ADDED,
 *       - a near-identical pair        -> UPDATED (a spelling correction; it has
 *                                         to be each other's best candidate and
 *                                         clear NAME_SIMILARITY_FLOOR),
 *       - equal counts                 -> paired in order, UPDATED,
 *       - unequal counts and no name   -> the lines are ADDED and the children are
 *         resolves them                  reported as UNRESOLVED and KEPT.
 *
 * THE LAST BULLET IS THE POINT. Guessing in an ambiguous bucket is what renames
 * one child and strikes off another, which is the bug this rewrite exists to kill.
 * A save must never remove a child the coach did not remove, so where the answer
 * is genuinely unknowable we keep her, do not touch her row, and tell the coach on
 * the SAVED screen which children we could not place.
 *
 * @returns {{updated:Array<{id:string,student_name:string,father_name:string|null}>,
 *            added:Array<{roll:string|null,student_name:string,father_name:string|null}>,
 *            removed:Array<object>,
 *            unresolved:Array<object>}}
 */
function reconcile(originals, edits) {
  const list = originals || [];
  const lines = edits || [];

  const matchedOrig = new Array(list.length).fill(false);
  const matchedEdit = new Array(lines.length).fill(false);
  const unresolvedOrig = new Array(list.length).fill(false);
  const pairs = [];
  // The subset of pairs used to bound the gaps in pass 4.
  const walls = [];

  const claim = (i, j, isWall) => {
    const fresh = !matchedOrig[i];
    matchedOrig[i] = true;
    matchedEdit[j] = true;
    pairs.push([i, j]);
    if (isWall && fresh) walls.push([i, j]);
  };

  const oName = (i) => list[i].student_name;
  const oFather = (i) => list[i].father_name;
  const eName = (j) => lines[j].student_name;
  const eFather = (j) => lines[j].father_name;
  const noRoll = (e) => e.roll === null || e.roll === undefined;

  // ── 1. the roll number ────────────────────────────────────────────────────
  const byKey = new Map();
  list.forEach((s, i) => { if (!rollMissing(s)) byKey.set(keyOf(s, i), i); });
  lines.forEach((e, j) => {
    if (noRoll(e) || !byKey.has(e.roll)) return;
    claim(byKey.get(e.roll), j, true);
  });

  // The lane the name matching works in. A numbered line and a numbered child
  // keep the roll-key contract exactly as before: unmatched means added/removed,
  // and pairMoves turns a matching add+remove into one child moving.
  const openOrig = [];
  const openEdit = [];
  list.forEach((s, i) => { if (!matchedOrig[i] && rollMissing(s)) openOrig.push(i); });
  lines.forEach((e, j) => { if (!matchedEdit[j] && noRoll(e)) openEdit.push(j); });

  const group = (idxs, keyFn) => {
    const m = new Map();
    idxs.forEach((i) => {
      const k = keyFn(i);
      const bucket = m.get(k);
      if (bucket) bucket.push(i); else m.set(k, [i]);
    });
    return m;
  };

  // ── 2. same name AND same father ──────────────────────────────────────────
  const exactO = group(openOrig, (i) => identityKey(oName(i), oFather(i)));
  const exactE = group(openEdit, (j) => identityKey(eName(j), eFather(j)));
  exactO.forEach((os, k) => {
    const es = exactE.get(k);
    if (!es) return;
    const n = Math.min(os.length, es.length);
    for (let x = 0; x < n; x += 1) claim(os[x], es[x], true);
  });

  // ── 3. same name, exactly one candidate on each side ──────────────────────
  const soleO = group(openOrig.filter((i) => !matchedOrig[i]), (i) => normName(oName(i)));
  const soleE = group(openEdit.filter((j) => !matchedEdit[j]), (j) => normName(eName(j)));
  soleO.forEach((os, k) => {
    const es = soleE.get(k);
    if (!es || os.length !== 1 || es.length !== 1) return;
    claim(os[0], es[0], true);
  });

  // ── 4. the gaps ───────────────────────────────────────────────────────────
  // Walls have to read as a staircase for the buckets to partition both sides, so
  // a match that crosses an earlier one (the coach moved a child up the page) is
  // kept as a match but dropped as a boundary.
  walls.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const stair = [];
  let lastEdit = -1;
  walls.forEach((w) => { if (w[1] > lastEdit) { stair.push(w); lastEdit = w[1]; } });

  const resolveGap = (gapO, gapE) => {
    let os = gapO;
    let es = gapE;

    if (os.length && es.length
      && os.length <= SIMILARITY_MAX_GAP && es.length <= SIMILARITY_MAX_GAP) {
      const cache = new Map();
      const score = (i, j) => {
        const k = `${i}:${j}`;
        let v = cache.get(k);
        if (v === undefined) {
          v = similarity(displayKey(oName(i), oFather(i)), displayKey(eName(j), eFather(j)));
          cache.set(k, v);
        }
        return v;
      };
      const bestFor = (i, pool) => pool.reduce((best, j) => (
        !matchedEdit[j] && score(i, j) > (best.v || 0) ? { j, v: score(i, j) } : best), {});
      const bestBack = (j, pool) => pool.reduce((best, i) => (
        !matchedOrig[i] && score(i, j) > (best.v || 0) ? { i, v: score(i, j) } : best), {});

      let progress = true;
      while (progress) {
        progress = false;
        os.forEach((i) => {
          if (matchedOrig[i]) return;
          const fwd = bestFor(i, es);
          if (fwd.j === undefined || fwd.v < NAME_SIMILARITY_FLOOR) return;
          if (bestBack(fwd.j, os).i !== i) return;
          claim(i, fwd.j, false);
          progress = true;
        });
      }
      os = os.filter((i) => !matchedOrig[i]);
      es = es.filter((j) => !matchedEdit[j]);
    }

    if (!os.length || !es.length) return;      // removals / additions fall out below
    if (os.length === es.length) {
      for (let x = 0; x < os.length; x += 1) claim(os[x], es[x], false);
      return;
    }
    // Unequal, and no name settles it. Either answer renames one child and strikes
    // off another. Keep them all and say so.
    os.forEach((i) => { unresolvedOrig[i] = true; });
  };

  const bounds = [[-1, -1], ...stair, [list.length, lines.length]];
  for (let b = 0; b + 1 < bounds.length; b += 1) {
    const [lo, loE] = bounds[b];
    const [hi, hiE] = bounds[b + 1];
    resolveGap(
      openOrig.filter((i) => i > lo && i < hi && !matchedOrig[i]),
      openEdit.filter((j) => j > loE && j < hiE && !matchedEdit[j]),
    );
  }

  // ── the diff ──────────────────────────────────────────────────────────────
  pairs.sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
  const updated = [];
  pairs.forEach(([i, j]) => {
    if (same(oName(i), eName(j)) && same(oFather(i), eFather(j))) return;
    updated.push({ id: list[i].id, student_name: eName(j), father_name: eFather(j) });
  });

  const added = [];
  lines.forEach((e, j) => {
    if (matchedEdit[j]) return;
    // Keep the roll the coach typed: in edit mode an add becomes a database row,
    // and a roll-less add cannot be told apart from a move (see pairMoves).
    added.push({ roll: noRoll(e) ? null : e.roll, student_name: e.student_name, father_name: e.father_name });
  });

  const removed = [];
  const unresolved = [];
  list.forEach((s, i) => {
    if (matchedOrig[i]) return;
    if (unresolvedOrig[i]) unresolved.push(s); else removed.push(s);
  });

  return { updated, added, removed, unresolved };
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
  return {
    updated: diff.updated || [],
    moved,
    added,
    removed: removedLeft,
    // Never a move and never a removal — a child we could not place, carried
    // through so the endpoint can tell the coach about her.
    unresolved: diff.unresolved || [],
  };
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
  NAME_SIMILARITY_FLOOR,
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
