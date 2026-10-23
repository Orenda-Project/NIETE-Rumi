'use strict';
/**
 * Writes a Grade 1-2 FDE practice paper (bd-5jmnfj.4.1): Grade 5's pattern writer,
 * cut down to what an early paper needs, plus pictures and the oral part.
 *
 *   1. every section is written from the whole book, in parallel with the oral part;
 *   2. the paper is laid out on the masked pattern (fde-early-prompt maskP), so none
 *      of Grade 5's per-subject layout rules apply;
 *   3. a section short of items, marking points or pictures is asked once more (a
 *      top-up when the layout alone set items aside); an oral task with nothing
 *      written is asked once more; a second miss fails the paper;
 *   4. the marking scheme is normalised, Maths keys are checked, the blueprint is
 *      read (report only), and every picture is drawn before the paper is returned.
 *
 * The service's private helpers are passed in as `d` (the service's _earlyDeps), so
 * this module never requires the service. Returns Grade 5's shape.
 */

const { applyLayout, takenNote } = require('./fde-layout');
const { normaliseScheme } = require('./marking-scheme');
const { mathsCheck } = require('./maths-check');
const { checkBlueprint } = require('./blueprint-check');
const Prompt = require('./fde-early-prompt');

const SCOPE = Object.freeze({ kind: 'fde', chapters: null, pages: null });
const ORAL_SECTION = Object.freeze({ id: 'oral', slots: [] });
const ORAL_SYSTEM = 'You write the oral part of primary-school practice papers for teachers in Pakistan. Return JSON only.';

function realPictures() {
  return require('./fde-pictures').resolvePictures;
}

async function writeEarlyPaper({ grade, subject, pattern, P, onSection = null, requestId = null }, d) {
  const startedAt = Date.now();
  const MP = Prompt.maskP(P);
  const loaded = await d.loadPatternContent({ grade, subject, P, scope: SCOPE, pageRanges: null, chapterNumber: null });
  if (typeof d.ensureCurrent === 'function') await d.ensureCurrent();
  const { model, job } = d.patternModel(d.family);
  const ownModel = d.resolveModelForJob('assessment.generate', { family: d.family }).model;
  const system = d.buildSystemPrompt({ subject, includeAnswerKey: true });

  const built = P.sections.map((section) => {
    const text = d.sectionText(section, loaded, SCOPE.kind, undefined);
    const user = Prompt.sectionPrompt(d.buildPatternUserPrompt, {
      grade, subject, pageContent: text.content, pageReference: text.pageReference,
      section, slots: section.slots, lang: P.medium, P, scope: SCOPE, poem: null,
    });
    return { section, user, pageContent: text.content, messages: d.sectionMessages({ system, user, pageContent: text.content, model }) };
  });
  const warmUsages = await d.warmSharedPrefixes({ built, model, job, requestId, pattern });

  const writeOne = async ({ section, messages }) => {
    const began = Date.now();
    const { tree, usages } = await d.writeSection({ messages, model, ownModel, job, pattern, section });
    const usage = d.sumUsage(usages);
    const elapsedMs = Date.now() - began;
    const slots = section.slots.map((s) => s.slot);
    d.logToFile('[assessment] generating', { requestId, pattern, section: section.id, slots, model, usage, cost: usage.cost ?? null, elapsedMs });
    if (onSection) {
      try { await onSection(section.id); } catch (err) { d.logToFile('[assessment] section progress not recorded', { section: section.id, error: err.message }); }
    }
    return { id: section.id, slots, usage, elapsedMs, tree, usages };
  };

  const oralUser = P.oral && Prompt.oralPrompt({ oral: P.oral, grade, P, pageContent: loaded.content });
  const writeOral = async (note) => {
    const user = note ? `${oralUser}\n\n${note}` : oralUser;
    const messages = d.sectionMessages({ system: ORAL_SYSTEM, user, pageContent: loaded.content, model });
    return d.writeSection({ messages, model, ownModel, job, pattern, section: ORAL_SECTION });
  };

  const [results, oralFirst] = await Promise.all([Promise.all(built.map(writeOne)), P.oral ? writeOral(null) : null]);
  const extraUsages = [];
  const now = new Date().toISOString();
  const merged = () => {
    const tree = d.mergeSections(results.map((r) => r.tree));
    d.stripImageKeys(tree);
    d.normaliseAnswers(tree);
    return tree;
  };
  // The layout runs on the masked pattern; the paper keeps its real subject (the renderer reads it).
  const lay = (reasked) => {
    const laid = applyLayout(merged(), MP, SCOPE, { now, presetId: pattern, reasked });
    laid.examJson._layout.subject = P.key;
    return laid;
  };

  const firstLaid = lay(false);
  const layoutShort = new Set(firstLaid.shortfall.map((f) => f.slot));
  const short = firstLaid.shortfall
    .concat(normaliseScheme(JSON.parse(JSON.stringify(firstLaid.examJson))).shortfall)
    .concat(d.emptyQuestionParts(firstLaid.examJson))
    .concat(Prompt.pictureShortfall(firstLaid.examJson, P))
    .concat(Prompt.repeatedPictures(firstLaid.examJson, P))
    .concat(Prompt.answerShortfall(firstLaid.examJson, P));
  const shortSlots = new Set(short.map((f) => f.slot));
  const again = built.filter(({ section }) => section.slots.some((s) => shortSlots.has(s.slot)));

  let oral = P.oral ? Prompt.oralContent(oralFirst.tree, P.oral) : null;
  const reaskOral = async () => {
    d.logToFile('[assessment] oral re-asked', { requestId, pattern, missing: oral.missing });
    const second = await writeOral(`Last time these tasks came back without what they need: ${oral.missing.join(', ')}. Write every task in full.`);
    const next = Prompt.oralContent(second.tree, P.oral);
    // A task the first reply filled keeps it; the second reply fills the rest.
    const content = P.oral.tasks
      .map((t) => oral.content.find((c) => c.id === t.id) || next.content.find((c) => c.id === t.id))
      .filter(Boolean);
    extraUsages.push(...second.usages);
    oral = { content, missing: P.oral.tasks.map((t) => t.id).filter((id) => !content.some((c) => c.id === id)) };
  };

  const reask = async (b) => {
    const shortfall = short.filter((f) => b.section.slots.some((s) => s.slot === f.slot));
    const i = results.findIndex((r) => r.id === b.section.id);
    const first = results[i];
    d.logToFile('[assessment] section re-asked', { requestId, pattern, section: b.section.id, shortfall });
    extraUsages.push(...first.usages);
    const topUp = shortfall.every((f) => layoutShort.has(f.slot));
    const pictures = shortfall.some((f) => f.reason === 'repeat')
      ? Prompt.takenPicturesNote(results.filter((r) => r.id !== b.section.id).map((r) => r.tree), shortfall)
      : null;
    const note = [takenNote(MP, b.section, firstLaid.examJson, { topUp, shortfall, held: firstLaid.held }), pictures, Prompt.answerNote(shortfall, P)]
      .filter(Boolean).join('\n\n');
    const second = await writeOne(note
      ? { ...b, messages: d.sectionMessages({ system, user: `${b.user}\n\n${note}`, pageContent: b.pageContent, model }) }
      : b);
    results[i] = topUp ? { ...second, tree: d.topUp(first.tree, second.tree, new Set(shortfall.map((f) => f.slot))) } : second;
  };
  // A section re-asked for a repeated picture goes one at a time, so each sees the others' new pictures.
  const repeats = new Set(short.filter((f) => f.reason === 'repeat').map((f) => f.slot));
  const isRepeat = (b) => b.section.slots.some((s) => repeats.has(s.slot));
  const inTurn = async () => { for (const b of again.filter(isRepeat)) await reask(b); };
  await Promise.all([...again.filter((b) => !isRepeat(b)).map(reask), inTurn(), oral && oral.missing.length ? reaskOral() : null]);

  const laid = lay(again.length > 0);
  let examJson = laid.examJson;
  const layout = { placed: laid.placed, unplaced: firstLaid.unplaced };
  d.logToFile('[assessment] layout applied', {
    requestId, pattern, placed: layout.placed, unplaced: layout.unplaced, totalMarks: examJson._layout.total_marks,
    sections: P.sections.map((s) => s.id), shortfall: laid.shortfall,
  });
  // A picture still repeated after the re-ask is logged, not failed: the teacher still gets a paper.
  const repeated = Prompt.repeatedPictures(examJson, P);
  if (repeated.length) d.logToFile('[assessment] repeated pictures', { requestId, pattern, repeated });
  // So is a key still off its slot's rule: one wrong item is better than no paper for the teacher.
  const answers = Prompt.answerShortfall(examJson, P);
  if (answers.length) d.logToFile('[assessment] answers off the rule', { requestId, pattern, answers });
  const finalShort = laid.shortfall.concat(d.emptyQuestionParts(examJson), Prompt.pictureShortfall(examJson, P));
  if (finalShort.length) {
    throw d.fail('PATTERN_SHORT_SLOT', 'A question slot came back short.', { shortfall: finalShort, examJson, model });
  }
  if (oral && oral.missing.length) {
    throw d.fail('ORAL_SHORT', 'The oral part came back short.', { missing: oral.missing, examJson, model });
  }

  const scheme = normaliseScheme(examJson);
  examJson = scheme.examJson;
  if (scheme.shortfall.length) {
    throw d.fail('PATTERN_SHORT_SLOT', 'A question slot came back short.', { shortfall: scheme.shortfall, examJson, model });
  }
  if (P.key === 'maths') examJson = mathsCheck(examJson, { subject: 'maths' }).examJson;

  const sectionLevels = P.sections.every((s) => s.levels) ? Object.fromEntries(P.sections.map((s) => [s.id, s.levels])) : null;
  const blueprint = checkBlueprint(examJson, { tos: P.tos || null, sectionLevels });
  examJson._layout.blueprint = blueprint;
  d.logToFile('[assessment] blueprint checked', { pattern, subject: P.key, ok: blueprint.ok, total: blueprint.total, levels: blueprint.levels, problems: blueprint.problems });
  if (P.oral) examJson._layout.oral = { ...P.oral, content: oral.content };

  try {
    await (d.resolvePictures || realPictures())(examJson);
  } catch (err) {
    err.examJson = examJson;
    err.model = model;
    throw err;
  }

  const all = d.sumUsage(warmUsages.concat(extraUsages, results.flatMap((r) => r.usages), oralFirst ? oralFirst.usages : []));
  return {
    examJson,
    questionCount: d.countQuestions(examJson),
    tokenData: { inputTokens: all.prompt_tokens, outputTokens: all.completion_tokens, totalTokens: all.total_tokens, cost: all.cost, model },
    pageReference: loaded.pageReference,
    chapterTitle: null,
    sections: results.map(({ id, slots, usage, elapsedMs }) => ({ id, slots, usage, elapsedMs })),
    elapsedMs: Date.now() - startedAt,
    layout,
  };
}

module.exports = { writeEarlyPaper, SCOPE, ORAL_SYSTEM };
