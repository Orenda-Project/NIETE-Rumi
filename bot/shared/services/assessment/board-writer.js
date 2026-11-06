'use strict';
/**
 * Writes a G6-12 board paper (SPEC §7, deps contract §5-§6). One call per section (per timed part), each told
 * what the earlier ones asked; teacher-marked slots generate nothing; a short slot is asked once more (a second
 * shortfall fails the paper: PATTERN_SHORT_SLOT; the top-up is T.topUp, never d.topUp, which is blind to OR and
 * stimulus nodes). Then board-layout, board-checks in board mode, one repair
 * round for hard issues (drop the item, ask once for that slot), then the scheme normaliser.
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
  const toppedUp = new Set();
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

  // 2. Layout, then the checks in board mode.
  const ids = (ex) => T.leavesOf(ex).map((l) => l.id);
  const stampAll = (ex) => T.stamp(ex, allSlots, (item) => d.stampSlo(grade, subject, item));
  // Penalty per top-level node from a probe run of the checks on a copy: 2 for a hard item, 1 for a soft note.
  const rankOf = (ex) => {
    const tops = (tree) => { const out = []; T.eachList(tree, (list) => list.forEach((q) => { if (q && typeof q === 'object') out.push(q); })); return out; };
    try {
      const probe = JSON.parse(JSON.stringify(ex));
      probe._layout = nested(buildLayout(P, V, probe, { presetId: pattern }), V.total_marks);
      settleKeys(probe);
      const run = d.checks.run(probe, { P, variant: V, mode: 'board', subjectConfig: row, probe: true });
      const top = new Map();
      tops(probe).forEach((q, i) => T.leavesOfNode(q).forEach((l) => top.set(l, i)));
      const byRef = new Map(leaves(probe).map((l) => [l.ref, l.item]));
      const pen = new Map();
      const add = (leaf, n) => { const i = top.get(leaf); if (i != null) pen.set(i, Math.max(pen.get(i) || 0, n)); };
      const hard = new Set(run.shortfall.flatMap((r) => r.items || []));
      T.leavesOf(probe).forEach((l) => { if (hard.has(l.id)) add(l, 2); });
      (run.notes || []).forEach((x) => add(byRef.get(x.item_ref), 1));
      const index = new Map(tops(ex).map((q, i) => [q, i]));
      return (q) => pen.get(index.get(q)) || 0;
    } catch (err) {
      d.logToFile('[assessment] trim ranking fell back to order', { error: err.message });
      return undefined;
    }
  };
  const finish = (ex, before) => {
    T.dropEmptyOptions(ex);
    stampAll(ex);
    if (T.overfull(ex, allSlots)) {
      T.trimExcess(ex, allSlots, rankOf(ex));
      stampAll(ex);
    }
    const fresh = before ? new Set(ids(ex).filter((id) => !before.has(id))) : undefined; // the repair's replacements
    ex._layout = nested(buildLayout(P, V, ex, { presetId: pattern }), V.total_marks);
    settleKeys(ex); // D13 key letters and numeric order are settled by code, not left to the model
    const checks = d.checks.run(ex, { P, variant: V, mode: 'board', subjectConfig: row, fresh });
    ex._layout.checks = checks.record;
    return checks;
  };
  let ex = mergedOf(trees);
  let checks = finish(ex);

  // 3. One repair round: a hard item is dropped and its slot asked for once more; a slot already asked fails.
  // The ask is told the keys already in the paper; the re-check blames a replacement, not the old item it collides with.
  if (checks.shortfall.length) {
    T.dropIds(ex, new Set(checks.shortfall.flatMap((r) => r.items)));
    const short = T.shortfallOf(ex, allSlots);
    if (short.some((r) => toppedUp.has(r.slot))) throw shortError(short, ex);
    const before = new Set(ids(ex));
    const used = usedKeys(ex);
    for (const unit of unitsOf(V)) {
      const mine = short.filter((r) => unit.slots.some((s) => s.slot === r.slot));
      if (!mine.length) continue;
      const second = await ask(unit, trees, SP.topUpNote(mine, used));
      ex = T.topUp(ex, second.tree, new Set(mine.map((r) => r.slot)));
    }
    checks = finish(ex, before);
    if (checks.shortfall.length) throw shortError(checks.shortfall, ex);
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
