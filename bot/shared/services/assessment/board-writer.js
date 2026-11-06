'use strict';
/**
 * Writes a G6-12 board paper (SPEC §7, deps contract §5-§6). One call per section (per timed part), each told
 * what the earlier ones asked; teacher-marked slots generate nothing; a short slot is asked once more (a second
 * shortfall fails the paper: PATTERN_SHORT_SLOT; the top-up is T.topUp, never d.topUp, which is blind to OR and
 * stimulus nodes). Then board-checks in board mode BEFORE the trim: hard items are dropped and the top-up's extras
 * fill the gap; a slot still short gets one targeted rewrite of the dropped items (round 5), and of the rewrite and
 * the originals the version with fewer hard issues is kept (a failure reports it). A same-section key leak that
 * survives that rewrite gets a second rewrite of the KEYED item, told the phrases not to use (round 6). Then the
 * scheme normaliser.
 *
 * The service's helpers arrive as `d` (_boardDeps); this module never requires the service, and never uses the
 * G5 layout engine (the layout is board-layout.js). Returns the board wrapper shape of _writePatternPaper.
 *
 * design_pending: `sloList` is optional on d (the FBISE keys' {slo_list}); without it the prompt says "none loaded".
 */
const { buildLayout } = require('./board-layout');
const { unitsOf, chunksOf, sized } = require('./board-6-12/units');
const SP = require('./board-6-12/section-prompt');
const T = require('./board-6-12/tree');
const { normaliseBoardScheme } = require('./board-6-12/scheme');
const { settleKeys } = require('./board-6-12/mcq-keys');
const { usedKeys } = require('./board-checks/key-leak');
const { leaves } = require('./board-checks/walk');

const EXTRA = 1.25; // design_pending: the top-up asks for the shortfall plus about a quarter (round 4)

const SHORT_MESSAGE = 'A section is still short of questions after one more try.';

/** board-layout's flat slots also nested into their sections (the checkers index by section; the renderers read the flat list). */
function nested(layout, total) {
  const { slots } = layout;
  return { ...layout, total_marks: total, sections: layout.sections.map((s) => ({ ...s, slots: slots.filter((x) => x.section === s.id) })) };
}

async function writeBoardPaper(args, d) {
  const { grade, subject, pattern, P, scope = null, pageRanges = null, chapterNumber = null, onSection = null, requestId = null } = args;
  const startedAt = Date.now();
  const row = d.resolveSubject(grade, subject);
  const V = args.variant || d.variantFor(P, { grade });
  if (!V) throw d.fail('PATTERN_NO_VARIANT', 'No variant of this board pattern applies.', { pattern, grade, subject });

  const loaded = await d.loadPatternContent({ grade, subject, P, scope, pageRanges, chapterNumber });
  if (typeof d.ensureCurrent === 'function') await d.ensureCurrent();
  const { model, job } = d.patternModel(d.family);
  const ownModel = d.resolveModelForJob('assessment.generate', { family: d.family }).model;
  const allSlots = V.sections.flatMap((s) => s.slots);
  const sloList = typeof d.sloList === 'function' ? d.sloList(grade, subject, chapterNumber) : undefined; // item 4: the chapter's matrix codes follow
  const usages = [];

  const ask = async (unit, done, note) => {
    const values = SP.promptValues({ grade, row, P, variant: V, unit, done, slotsAll: allSlots, sloList });
    const system = d.assemble({ row, kind: 'board', values });
    const user = SP.userPrompt({ content: loaded.content, pageReference: loaded.pageReference, note });
    const messages = d.sectionMessages({ system, user, pageContent: loaded.content, model });
    const began = Date.now();
    const got = await d.writeSection({ messages, model, ownModel, job, pattern, section: { id: unit.key, slots: unit.slots } });
    usages.push(...got.usages);
    // The reply is keyed by slot id (eg.format.secondary); code places it in the tree and stamps each node's slot.
    return { tree: T.fromReply(got.tree, unit.slots), usages: got.usages, elapsedMs: Date.now() - began };
  };
  const shortError = (shortfall, examJson) => d.fail('PATTERN_SHORT_SLOT', SHORT_MESSAGE, { shortfall, examJson, model });
  const mergedOf = (trees) => {
    const ex = d.mergeSections(trees);
    d.stripImageKeys(ex);
    d.normaliseAnswers(ex);
    T.dropEmptyOptions(ex);
    return ex;
  };
  const slotSet = (slots) => new Set(slots.map((s) => s.slot));

  // 1. Section by section, in turn; each short slot gets one more ask.
  const trees = [];
  const sections = [];
  const toppedUp = new Set(); // for the log line only (round 5: a topped-up slot may still be rewritten)
  for (const unit of unitsOf(V)) {
    if (!unit.generates) continue;
    // A slot of more than 20 items is asked in chunks; a later chunk sees the earlier stems and the keys so far.
    let tree = null;
    let used = [];
    let firstMs = 0;
    for (const part of chunksOf(unit)) {
      const note = part.chunk && part.chunk.from > 1 ? SP.chunkNote(part.chunk, usedKeys(d.mergeSections(trees.concat([tree])))) : null;
      const got = await ask(part, tree ? trees.concat([tree]) : trees, note);
      used = used.concat(got.usages);
      firstMs += got.elapsedMs;
      const mine = T.trimExcess(got.tree, part.slots);
      tree = tree ? T.topUp(tree, mine, slotSet(part.slots)) : mine;
    }
    let short = T.shortfallOf(tree, unit.slots);
    if (short.length) {
      // One top-up for the shortfall plus about a quarter; the extras stay until finish() trims the weakest.
      const rows = short.map((r) => ({ ...r, write: Math.ceil((r.need - r.have) * EXTRA) }));
      const slots = unit.slots.filter((s) => rows.some((r) => r.slot === s.slot))
        .map((s) => sized(s, rows.find((r) => r.slot === s.slot).write));
      rows.forEach((r) => { r.write = slots.find((s) => s.slot === r.slot).generate; });
      const second = await ask({ ...unit, slots }, trees, SP.topUpNote(rows));
      used = used.concat(second.usages);
      tree = T.topUp(tree, second.tree, slotSet(slots));
      short.forEach((r) => toppedUp.add(r.slot));
      short = T.shortfallOf(tree, unit.slots);
      if (short.length) throw shortError(short, mergedOf(trees.concat([tree])));
    }
    trees.push(tree);
    const usage = d.sumUsage(used);
    sections.push({ id: unit.key, slots: unit.slots.map((s) => s.slot), usage, elapsedMs: firstMs });
    d.logToFile('[assessment] board section written', { requestId, pattern, section: unit.key, model, usage, topUp: toppedUp.size > 0 });
    if (onSection) {
      try { await onSection(unit.key); } catch (err) { d.logToFile('[assessment] section progress not recorded', { section: unit.key, error: err.message }); }
    }
  }

  // 2. Checks before the trim (round 5): hard items are dropped, the +25% extras fill the gap, then the trim.
  const ids = (ex) => T.leavesOf(ex).map((l) => l.id);
  const stampAll = (ex) => T.stamp(ex, allSlots, (item) => d.stampSlo(grade, subject, item));
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const probeRun = (ex) => {
    try {
      const probe = clone(ex);
      probe._layout = nested(buildLayout(P, V, probe, { presetId: pattern }), V.total_marks);
      settleKeys(probe);
      return { probe, run: d.checks.run(probe, { P, variant: V, mode: 'board', subjectConfig: row, probe: true }) };
    } catch (err) {
      d.logToFile('[assessment] pre-trim check fell back to order', { error: err.message });
      return null;
    }
  };
  const hardIds = (run) => new Set(run.shortfall.flatMap((r) => r.items || []));
  // Penalty per top-level node from a probe run of the checks on a copy: 2 for a hard item, 1 for a soft note.
  const rankOf = (ex) => {
    const got = probeRun(ex);
    if (!got) return undefined;
    const { probe, run } = got;
    const tops = (tree) => { const out = []; T.eachList(tree, (list) => list.forEach((q) => { if (q && typeof q === 'object') out.push(q); })); return out; };
    const top = new Map();
    tops(probe).forEach((q, i) => T.leavesOfNode(q).forEach((l) => top.set(l, i)));
    const byRef = new Map(leaves(probe).map((l) => [l.ref, l.item]));
    const pen = new Map();
    const add = (leaf, n) => { const i = top.get(leaf); if (i != null) pen.set(i, Math.max(pen.get(i) || 0, n)); };
    const hard = hardIds(run);
    T.leavesOf(probe).forEach((l) => { if (hard.has(l.id)) add(l, 2); });
    (run.notes || []).forEach((x) => add(byRef.get(x.item_ref), 1));
    const index = new Map(tops(ex).map((q, i) => [q, i]));
    return (q) => pen.get(index.get(q)) || 0;
  };
  const finish = (ex, before) => {
    T.dropEmptyOptions(ex);
    stampAll(ex);
    if (T.overfull(ex, allSlots)) {
      T.trimExcess(ex, allSlots, rankOf(ex));
      stampAll(ex);
    }
    const fresh = before ? new Set(ids(ex).filter((id) => !before.has(id))) : undefined; // the rewrites
    ex._layout = nested(buildLayout(P, V, ex, { presetId: pattern }), V.total_marks);
    settleKeys(ex); // D13 key letters and numeric order are settled by code, not left to the model
    const checks = d.checks.run(ex, { P, variant: V, mode: 'board', subjectConfig: row, fresh });
    ex._layout.checks = checks.record;
    return checks;
  };
  const dropped = []; // {slot, question} of every item the checks removed
  const drop = (ex, bad) => {
    T.leavesOf(ex).forEach((l) => { if (bad.has(l.id)) dropped.push({ slot: String(l.id).split(/[#@/]/)[0], question: l.question }); });
    T.dropIds(ex, bad);
  };
  let ex = mergedOf(trees);
  T.dropEmptyOptions(ex);
  stampAll(ex);
  const whole = clone(ex); // every item written, for the keep-the-fewer comparison
  const pre = probeRun(ex);
  if (pre) drop(ex, hardIds(pre.run));
  let checks = finish(ex);

  // 3. One targeted rewrite of the dropped items (same slot, told the used keys and the stems to avoid). Nothing new
  // is asked for the slot, so a topped-up slot may be rewritten. Of the rewrite and the originals, fewer hard wins.
  const rewrite = async (tree, from, phrases = []) => {
    let out = tree;
    const short = T.shortfallOf(out, allSlots);
    const used = usedKeys(out);
    for (const unit of unitsOf(V)) {
      const mine = short.filter((r) => unit.slots.some((s) => s.slot === r.slot)).map((r) => ({ ...r, write: r.need - r.have }));
      if (!mine.length) continue;
      const slots = unit.slots.filter((s) => mine.some((r) => r.slot === s.slot)).map((s) => sized(s, mine.find((r) => r.slot === s.slot).write));
      const stems = dropped.slice(from).filter((x) => mine.some((r) => r.slot === x.slot)).map((x) => x.question);
      const second = await ask({ ...unit, slots }, trees, SP.rewriteNote(mine, stems, used, phrases));
      out = T.topUp(out, second.tree, slotSet(slots));
    }
    return out;
  };
  const failing = (tree, run) => run.shortfall.length > 0 || T.shortfallOf(tree, allSlots).length > 0;
  if (failing(ex, checks)) {
    drop(ex, hardIds(checks));
    let before = new Set(ids(ex));
    ex = await rewrite(ex, 0);
    checks = finish(ex, before);
    const tries = [{ ex, checks }];
    // 3b (round 6). A same-section concept leak left after that: one rewrite of the KEYED items, told the phrases.
    const keyed = checks.shortfall.flatMap((r) => r.keyed || []);
    if (failing(ex, checks) && keyed.length) {
      const next = clone(ex);
      const from = dropped.length;
      drop(next, new Set(keyed.map((k) => k.id)));
      before = new Set(ids(next));
      const phrases = [...new Set(keyed.map((k) => k.phrase))];
      const ex2 = await rewrite(next, from, phrases);
      const checks2 = finish(ex2, before);
      tries.unshift({ ex: ex2, checks: checks2 });
      ex = ex2;
      checks = checks2;
    }
    if (failing(ex, checks)) {
      const orig = clone(whole);
      tries.push({ ex: orig, checks: finish(orig) });
      const best = tries.reduce((a, b) => (b.checks.record.hard < a.checks.record.hard ? b : a));
      throw shortError(best.checks.shortfall.length ? best.checks.shortfall : T.shortfallOf(best.ex, allSlots), best.ex);
    }
  }

  // 4. The scheme, per the variant's style; then the record.
  normaliseBoardScheme(ex, V.scheme_style);
  const total = d.sumUsage(usages);
  ex._meta = {
    generator_model: model, mode: 'board', grade, subject, band: row.band, variant: V.variant_id,
    checks: { shortfall: checks.shortfall, notes: checks.notes, record: checks.record },
  };
  const questionCount = d.countQuestions(ex);
  return {
    examJson: ex,
    questionCount,
    tokenData: { inputTokens: total.prompt_tokens, outputTokens: total.completion_tokens, totalTokens: total.total_tokens, cost: total.cost, model },
    pageReference: loaded.pageReference,
    chapterTitle: null,
    sections,
    elapsedMs: Date.now() - startedAt,
    layout: { placed: questionCount, unplaced: 0 },
  };
}

module.exports = { writeBoardPaper };
