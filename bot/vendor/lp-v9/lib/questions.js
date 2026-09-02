// EVERY QUESTION THE LP ASKS, in one list, each with a stable ref.
//
// One function, two consumers, on purpose. The renderer uses it to print the QUESTION above
// its model answer (the expert's "answers that never say what they answer"); lint uses it for
// REF_ABSENT, DUP_QUESTION and UNWORDED_Q. If they built their own lists they would disagree,
// and the page would look complete while the gate said otherwise — which is the exact failure
// mode this whole rework exists to remove.
//
// A ref is either AUTHORED (`item.ref`) or DERIVED (W1, P1, X1, C1, H1 …). The derived form
// keeps a doc that has not adopted refs yet resolvable, and the authored form is what a model
// answer points at.

/** Depth-first over blocks, `split` children included. */
function allBlocks(blocks, out = []) {
  for (const b of blocks || []) {
    out.push(b);
    if (b.type === "split") { allBlocks(b.left, out); allBlocks(b.right, out); }
  }
  return out;
}

/**
 * @returns {Array<{ref, q, a, kind, where, level, format}>}
 *   kind: warmup | practice | exit | checkpoint | homework | exam
 *   `a` is null for anything whose answer lives only in the reference block (homework).
 */
function allQuestions(doc) {
  const out = [];
  let nW = 0, nP = 0, nX = 0, nC = 0, nH = 0, nE = 0;
  const sections = doc.sections || [];

  for (const s of sections) {
    if (s.warmup && Array.isArray(s.warmup.items)) {
      for (const it of s.warmup.items) {
        out.push({ ref: it.ref || `W${++nW}`, q: it.q, a: it.a, kind: "warmup", where: `${s.id} warm-up` });
        if (it.ref) nW++;
      }
    }
    for (const b of allBlocks(s.blocks)) {
      if (b.type !== "practice") continue;
      for (const it of b.items || []) {
        out.push({ ref: it.ref || `P${++nP}`, q: it.q, a: it.a, kind: "practice",
          where: `${s.id} ${b.mode || "practice"}`, level: it.level });
        if (it.ref) nP++;
      }
    }
    for (const x of s.exit_ticket || []) {
      out.push({ ref: x.ref || `X${++nX}`, q: x.q, a: x.a, kind: "exit", where: `${s.id} exit ticket` });
      if (x.ref) nX++;
    }
    if (s.checkpoint) {
      out.push({ ref: s.checkpoint.ref || `C${++nC}`, q: s.checkpoint.question, a: null,
        kind: "checkpoint", where: `${s.id} checkpoint` });
    }
    if (s.homework && Array.isArray(s.homework.items)) {
      for (const it of s.homework.items) {
        out.push({ ref: it.ref || `H${++nH}`, q: it.text, a: null, kind: "homework",
          where: "homework", level: it.level, format: it.format, slo_code: it.slo_code });
        if (it.ref) nH++;
      }
    }
  }

  const eb = (doc.page2 && doc.page2.exam_bank) || {};
  for (const m of eb.mcq || []) out.push({ ref: m.ref || `E${++nE}`, q: m.q, a: m.answer, kind: "exam", where: "exam bank MCQ" });
  if (eb.srq) out.push({ ref: eb.srq.ref || `E${++nE}`, q: eb.srq.q, a: null, kind: "exam", where: "exam bank SRQ" });
  if (eb.erq_skeleton && eb.erq_skeleton.q) {
    out.push({ ref: eb.erq_skeleton.ref || `E${++nE}`, q: eb.erq_skeleton.q, a: null, kind: "exam", where: "exam bank ERQ" });
  }
  return out;
}

/** ref -> question. First writer wins, so a duplicated ref is visible to lint rather than lost. */
function questionIndex(doc) {
  const map = new Map();
  for (const q of allQuestions(doc)) if (!map.has(q.ref)) map.set(q.ref, q);
  return map;
}

/** Refs declared more than once — an ambiguous target for a model answer. */
function duplicateRefs(doc) {
  const seen = new Set();
  const dup = new Set();
  for (const q of allQuestions(doc)) (seen.has(q.ref) ? dup : seen).add(q.ref);
  return [...dup];
}

module.exports = { allQuestions, questionIndex, duplicateRefs, allBlocks };
