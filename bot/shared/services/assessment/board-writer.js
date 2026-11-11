'use strict';
/**
 * Writes a G6-12 board paper (SPEC §7, deps contract §5-§6). One call per section (per timed part), each told
 * what the earlier ones asked; teacher-marked slots generate nothing; a short slot is asked once more (a second
 * shortfall fails: PATTERN_SHORT_SLOT; the top-up is T.topUp, blind to OR and stimulus nodes only in d.topUp). Then
 * board-checks BEFORE the trim: hard items are dropped, the extras fill the gap, one targeted rewrite (round 5) and
 * a second of the keyed item (rounds 6-7) follow; the version with fewer hard issues is kept (a failure reports it). A
 * faulted stimulus-group member is re-asked GF.ATTEMPTS times; a review flag or D22 left then ships as a paper-level note.
 * The service's helpers arrive as `d` (_boardDeps); this module never requires the service, and never uses the
 * G5 layout engine (the layout is board-layout.js). Returns the board wrapper shape of _writePatternPaper.
 *
 * design_pending: `sloList` is optional on d (the FBISE keys' {slo_list}); without it the prompt says "none loaded".
 */
const { buildLayout } = require('./board-layout');
const { unitsOf, chunksOf, sized } = require('./board-6-12/units');
const SP = require('./board-6-12/section-prompt');
const BL = require('./board-6-12/book-level');
const T = require('./board-6-12/tree');
const { normaliseBoardScheme } = require('./board-6-12/scheme');
const { settleKeys } = require('./board-6-12/mcq-keys');
const { usedKeys } = require('./board-checks/key-leak');
const { leaves } = require('./board-checks/walk');
const { owed } = require('./board-6-12/slot-quota');
const MR = require('./board-6-12/mcq-review');
const GF = require('./board-6-12/group-faults');
const SN = require('./board-6-12/ship-notes');
const LL = require('./board-6-12/level-log');
const LT = require('./board-6-12/last-try');

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
  const logSplit = LL.splitLogger(d, V, { requestId, pattern, grade, subject }); // bd-qyi45h.1: one line per check run, no person ids
  // A6b (round 9): a top-up or rewrite slot carries the levels it still owes against its full quota
  const split = SP.levelPart(V, row);
  const quotaed = (s, tree, n) => { const one = sized(s, n); const quota = split ? owed(s, tree, split.levels, one.generate) : null; return quota ? { ...one, quota } : one; };
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
  const shortError = (shortfall, examJson, detail) => d.fail('PATTERN_SHORT_SLOT', SHORT_MESSAGE, { shortfall, examJson, model, ...(detail ? { detail } : {}) });
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
        .map((s) => quotaed(s, tree, rows.find((r) => r.slot === s.slot).write));
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
  const stampAll = (ex) => { T.stamp(ex, allSlots, (item) => d.stampSlo(grade, subject, item)); BL.relevel(ex, loaded.content); }; // r10: book repeats are K
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
    logSplit(ex);
    return checks;
  };
  // Round 9: one review call per section, MCQs only (d.reviewMcqs); a yes on any of its five questions makes the
  // item hard. Flags are kept by item text, so an item flagged once stays hard in every later try that holds it.
  const flags = [];
  let passes = 0;
  const seenSigs = new Set(); // round 9b: each MCQ text is reviewed once
  const reviewCall = async ({ id, n, system, user }) => {
    const messages = d.sectionMessages({ system, user, pageContent: loaded.content, model });
    const got = await d.writeSection({ messages, model, ownModel, job, pattern, section: { id, slots: [{ slot: id, type: 'mcq', shape: 'mcq', generate: n, marks_each: 1 }] } });
    usages.push(...got.usages);
    return got.tree;
  };
  const reviewed = async (ex, checks, only) => {
    if (!d.reviewMcqs) return checks;
    const before = seenSigs.size;
    const got = await MR.reviewPaper({ examJson: ex, grade, call: reviewCall, only, seen: seenSigs, onError: (err) => d.logToFile('[assessment] board MCQ review failed', { error: err.message }) });
    flags.push(...got);
    d.logToFile('[assessment] board MCQ review', { pass: ++passes, reviewed: seenSigs.size - before, ...MR.tally(got) });
    return MR.applyFlags(checks, flags, ex);
  };
  const dropped = []; // {slot, question, check} of every item the checks removed
  const drop = (ex, bad, run) => {
    const why = Object.assign({}, ...((run && run.shortfall) || []).map((r) => r.why || {}));
    T.leavesOf(ex).forEach((l) => { if (bad.has(l.id)) dropped.push({ slot: String(l.id).split(/[#@/]/)[0], question: l.question, check: why[l.id] }); });
    T.dropIds(ex, bad);
  };
  let ex = mergedOf(trees);
  T.dropEmptyOptions(ex);
  stampAll(ex);
  const whole = clone(ex); // every item written, for the keep-the-fewer comparison
  const pre = probeRun(ex);
  if (pre) drop(ex, hardIds(pre.run), pre.run);
  let checks = await reviewed(ex, finish(ex));
  // 3. One targeted rewrite of the dropped items (same slot, told the used keys and the stems to avoid). Nothing new
  // is asked for the slot, so a topped-up slot may be rewritten. Of the rewrite and the originals, fewer hard wins.
  const rewrite = async (tree, from, phrases = []) => {
    let out = tree;
    const short = T.shortfallOf(out, allSlots);
    const used = usedKeys(out);
    for (const unit of unitsOf(V)) {
      const mine = short.filter((r) => unit.slots.some((s) => s.slot === r.slot)).map((r) => ({ ...r, write: r.need - r.have }));
      if (!mine.length) continue;
      const slots = unit.slots.filter((s) => mine.some((r) => r.slot === s.slot)).map((s) => quotaed(s, out, mine.find((r) => r.slot === s.slot).write));
      const gone = dropped.slice(from).filter((x) => mine.some((r) => r.slot === x.slot));
      const figure = gone.some((x) => x.check === 'N20');
      const stems = gone.map((x) => x.question);
      const second = await ask({ ...unit, slots }, trees, SP.rewriteNote(mine, stems, used, phrases, figure, [...MR.faultLines(flags, stems), ...SP.checkFaults(gone)]));
      out = T.topUp(out, second.tree, slotSet(slots));
    }
    return out;
  };
  // Drop `bad` from a copy of `src`, ask for replacements, re-check with them marked fresh.
  const reask = async (src, bad, run, phrases) => {
    const next = clone(src);
    const from = dropped.length;
    drop(next, bad, run);
    const was = new Set(ids(next));
    const out = await rewrite(next, from, phrases);
    return { ex: out, checks: await reviewed(out, finish(out, was), new Set(ids(out).filter((id) => !was.has(id)))) };
  };
  const failing = (tree, run) => run.shortfall.length > 0 || T.shortfallOf(tree, allSlots).length > 0;
  // round 8: the checks each try's hard issues came from
  const byCheck = (rec) => Object.fromEntries(Object.entries(rec.per_check || {}).filter(([, v]) => v.hard > 0).map(([k, v]) => [k, v.hard]));
  const outcome = (tries, kept) => d.logToFile('[assessment] board rewrite outcome', {
    kept: kept.name,
    tries: tries.map((t) => ({ name: t.name, hard: t.checks.record.hard, by_check: byCheck(t.checks.record) })),
  });
  if (failing(ex, checks)) {
    // round 9b: the items dropped for the review alone, kept to put back where their replacement fails a hard check
    const reviewOnly = new Set(checks.shortfall.flatMap((r) => Object.keys(r.why || {}).filter((id) => r.why[id] === 'review')));
    const spare = clone(ex);
    T.dropIds(spare, new Set(ids(spare).filter((id) => !reviewOnly.has(id))));
    drop(ex, hardIds(checks), checks);
    const before = new Set(ids(ex));
    ex = await rewrite(ex, 0);
    checks = await reviewed(ex, finish(ex, before), new Set(ids(ex).filter((id) => !before.has(id))));
    const tries = [{ name: 'rewrite 1', ex, checks }];
    // 3b (round 6): a concept leak left after that gets a rewrite of the KEYED items, told the phrases (round 7: the plain holder of a group child's key).
    const keyed = checks.shortfall.flatMap((r) => r.keyed || []);
    if (failing(ex, checks) && keyed.length) {
      const inGroup = new Set();
      T.eachList(ex, (list) => list.forEach((q) => { if (T.isGroup(q)) T.leavesOfNode(q).forEach((l) => inGroup.add(l.id)); }));
      const target = (k) => (inGroup.has(k.id) && k.holder != null && !inGroup.has(k.holder) ? k.holder : k.id);
      const got = await reask(ex, new Set(keyed.map(target)), checks, [...new Set(keyed.map((k) => k.phrase))]);
      tries.unshift({ name: 'rewrite 2', ...got });
      ({ ex, checks } = got);
    }
    // 3c (bd-5jmnfj.38.34): a review fault inside a kept group is re-asked up to GF.ATTEMPTS times (a fresh group is flagged ~45% per item)
    for (let n = 0, stuck = GF.stuck(checks, ex); n < GF.ATTEMPTS && failing(ex, checks) && stuck.size; n += 1, stuck = GF.stuck(checks, ex)) {
      const got = await reask(ex, stuck, checks);
      tries.unshift({ name: `rewrite ${3 + n}`, ...got });
      ({ ex, checks } = got);
    }
    MR.soften(checks, { hold: true, groups: GF.memberIds(ex) }); // round 9b: the review's leftovers turn to notes; leaks and group members are held for the restore
    if (failing(ex, checks) && reviewOnly.size) {
      const back = clone(ex);
      T.dropIds(back, T.droppable(back, hardIds(checks), spare)); // round 10: never leaves a slot fill cannot refill
      const want = new Map(T.shortfallOf(back, allSlots).map((r) => [r.slot, r.need - r.have]));
      const owes = new Map([...want].map(([slot, n]) => [slot, split ? owed(allSlots.find((x) => x.slot === slot), back, split.levels, n) : null]));
      const lvl = (q) => { const it = Array.isArray(q.or) ? q.or[0] : q; return it && it.tag && it.tag.blooms; };
      const ex3 = T.fill(back, spare, want, (q) => { const o = owes.get(q.slot); return o && o[lvl(q)] > 0 ? 0 : 1; }); // owed levels first (A6b)
      const checks3 = MR.soften(MR.applyFlags(finish(ex3), flags, ex3), { hold: true, groups: GF.memberIds(ex3) });
      tries.unshift({ name: 'restore', ex: ex3, checks: checks3 });
      if (checks3.record.hard <= checks.record.hard) { ex = ex3; checks = checks3; }
    }
    if (failing(ex, checks)) SN.finalSoften(checks, GF.memberIds(ex)); // ship with note: a held flag or D22 nothing replaced is a paper-level note
    if (failing(ex, checks)) {
      const orig = clone(whole);
      tries.push({ name: 'originals', ex: orig, checks: SN.finalSoften(MR.applyFlags(finish(orig), flags, orig), GF.memberIds(orig)) });
      const best = tries.reduce((a, b) => (b.checks.record.hard < a.checks.record.hard ? b : a));
      outcome(tries, best);
      const short = T.shortfallOf(best.ex, allSlots);
      if (!LT.canShip(best.checks, { grade, slotsShort: short })) throw shortError(best.checks.shortfall.length ? best.checks.shortfall : short, best.ex, LL.hardDetail(best.checks.record));
      ex = best.ex; checks = LT.ship(best.checks); d.logToFile('[assessment] board paper shipped on last try', { requestId, pattern, grade, subject, rules: checks.record.shipped_last_try }); // bd-qyi45h.3
    } else outcome(tries, tries[0]);
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
    examJson: ex, questionCount,
    tokenData: { inputTokens: total.prompt_tokens, outputTokens: total.completion_tokens, totalTokens: total.total_tokens, cost: total.cost, model },
    pageReference: loaded.pageReference,
    chapterTitle: null,
    sections,
    elapsedMs: Date.now() - startedAt,
    layout: { placed: questionCount, unplaced: 0 },
  };
}

module.exports = { writeBoardPaper };
