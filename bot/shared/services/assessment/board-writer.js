'use strict';
/**
 * Writes a G6-12 board paper (SPEC §7, deps contract §5-§6). One call per section (per timed part), each told
 * what the earlier ones asked; teacher-marked slots generate nothing; a short slot is asked once more (a second
 * shortfall fails the paper: PATTERN_SHORT_SLOT). Then board-layout, board-checks in board mode, one repair
 * round for hard issues (drop the item, ask once for that slot), then the scheme normaliser.
 *
 * The service's helpers arrive as `d` (_boardDeps); this module never requires the service, and never uses the
 * G5 layout engine (the layout is board-layout.js). Returns the board wrapper shape of _writePatternPaper.
 *
 * design_pending: `sloList` is optional on d (the FBISE keys' {slo_list}); without it the prompt says "none loaded".
 */
const { buildLayout } = require('./board-layout');
const { unitsOf } = require('./board-6-12/units');
const SP = require('./board-6-12/section-prompt');
const T = require('./board-6-12/tree');
const { normaliseBoardScheme } = require('./board-6-12/scheme');

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
  const sloList = typeof d.sloList === 'function' ? d.sloList(grade, subject) : undefined;
  const usages = [];

  const ask = async (unit, done, note) => {
    const values = SP.promptValues({ grade, row, P, variant: V, unit, done, slotsAll: allSlots, sloList });
    const system = d.assemble({ row, kind: 'board', values });
    const user = SP.userPrompt({ content: loaded.content, pageReference: loaded.pageReference, note });
    const messages = d.sectionMessages({ system, user, pageContent: loaded.content, model });
    const began = Date.now();
    const got = await d.writeSection({ messages, model, ownModel, job, pattern, section: { id: unit.key, slots: unit.slots } });
    usages.push(...got.usages);
    return { tree: got.tree, usages: got.usages, elapsedMs: Date.now() - began };
  };
  const shortError = (shortfall, examJson) => d.fail('PATTERN_SHORT_SLOT', SHORT_MESSAGE, { shortfall, examJson, model });
  const mergedOf = (trees) => {
    const ex = d.mergeSections(trees);
    d.stripImageKeys(ex);
    d.normaliseAnswers(ex);
    return ex;
  };

  // 1. Section by section, in turn; each short slot gets one more ask.
  const trees = [];
  const sections = [];
  const toppedUp = new Set();
  for (const unit of unitsOf(V)) {
    if (!unit.generates) continue;
    const first = await ask(unit, trees, null);
    let tree = T.trimExcess(first.tree, unit.slots);
    let short = T.shortfallOf(tree, unit.slots);
    let used = first.usages;
    if (short.length) {
      const second = await ask(unit, trees, SP.topUpNote(short));
      used = used.concat(second.usages);
      tree = T.trimExcess(d.topUp(tree, second.tree, new Set(short.map((r) => r.slot))), unit.slots);
      short.forEach((r) => toppedUp.add(r.slot));
      short = T.shortfallOf(tree, unit.slots);
      if (short.length) throw shortError(short, mergedOf(trees.concat([tree])));
    }
    trees.push(tree);
    const usage = d.sumUsage(used);
    sections.push({ id: unit.key, slots: unit.slots.map((s) => s.slot), usage, elapsedMs: first.elapsedMs });
    d.logToFile('[assessment] board section written', { requestId, pattern, section: unit.key, model, usage, topUp: short.length === 0 && used.length > first.usages.length });
    if (onSection) {
      try { await onSection(unit.key); } catch (err) { d.logToFile('[assessment] section progress not recorded', { section: unit.key, error: err.message }); }
    }
  }

  // 2. Layout, then the checks in board mode.
  const finish = (ex) => {
    T.trimExcess(ex, allSlots);
    T.stamp(ex, allSlots, (item) => d.stampSlo(grade, subject, item));
    ex._layout = nested(buildLayout(P, V, ex), V.total_marks);
    const checks = d.checks.run(ex, { P, variant: V, mode: 'board', subjectConfig: row });
    ex._layout.checks = checks.record;
    return checks;
  };
  let ex = mergedOf(trees);
  let checks = finish(ex);

  // 3. One repair round: a hard item is dropped and its slot asked for once more; a slot already asked fails.
  if (checks.shortfall.length) {
    T.dropIds(ex, new Set(checks.shortfall.flatMap((r) => r.items)));
    const short = T.shortfallOf(ex, allSlots);
    if (short.some((r) => toppedUp.has(r.slot))) throw shortError(short, ex);
    for (const unit of unitsOf(V)) {
      const mine = short.filter((r) => unit.slots.some((s) => s.slot === r.slot));
      if (!mine.length) continue;
      const second = await ask(unit, trees, SP.topUpNote(mine));
      ex = d.topUp(ex, second.tree, new Set(mine.map((r) => r.slot)));
    }
    checks = finish(ex);
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
