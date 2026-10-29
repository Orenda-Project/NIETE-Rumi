'use strict';
/**
 * Writes a Grade 1-2 FDE practice paper (bd-5jmnfj.4.1): Grade 5's pattern writer,
 * cut down to what an early paper needs, plus pictures and the oral part.
 *
 *   1. every section is written from the whole book, one after another, each told what the
 *      earlier ones asked so no fact is asked twice; the oral part is written beside them;
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
const { dealOrders } = require('./fde-order-block');
const { noArrows } = require('./fde-no-arrows');
const { answerRepeats, giveawayNote, stillGivenAway, writtenGiveaways } = require('./fde-answer-repeats');
const { dealScrambles } = require('./fde-scramble-block');
const { keyShortfall } = require('./fde-key-checks');
const { whoSaidShortfall } = require('./fde-who-said-check'); const { freshReadWords } = require('./fde-oral-fresh-words'); // bd-5jmnfj.4.58.4
const { earlyKeyFixes } = require('./fde-early-key-fixes'); const { commonErrorNumbers } = require('./fde-common-error-numbers'); const { earlyEnglishFixes } = require('./fde-early-english-fixes'); const { earlyUrduFixes } = require('./fde-early-urdu-fixes'); // bd-5jmnfj.4.58.3/.4

const SCOPE = Object.freeze({ kind: 'fde', chapters: null, pages: null });
const ORAL_SECTION = Object.freeze({ id: 'oral', slots: [] });
const ORAL_SYSTEM = 'You write the oral part of primary-school practice papers for teachers in Pakistan. Return JSON only.';

function realPictures() {
  return require('./fde-pictures').resolvePictures;
}

const eachList = (tree, fn) => Object.values(tree || {}).forEach((branch) => Object.values(branch || {}).forEach((types) => {
  if (types && typeof types === 'object') Object.keys(types).forEach((k) => { if (Array.isArray(types[k])) fn(types, k); });
}));

// The kept tree with the fresh reply's items in place of its own for `slots`; a slot the reply left
// empty keeps what it had.
function swapSlots(kept, fresh, slots) {
  const got = new Map();
  eachList(fresh, (types, k) => types[k].forEach((q) => {
    if (q && slots.has(q.slot)) got.set(q.slot, (got.get(q.slot) || []).concat(q));
  }));
  const out = JSON.parse(JSON.stringify(kept));
  eachList(out, (types, k) => {
    const done = new Set();
    types[k] = types[k].flatMap((q) => {
      if (!q || !got.has(q.slot)) return [q];
      if (done.has(q.slot)) return [];
      done.add(q.slot);
      return got.get(q.slot);
    });
  });
  return out;
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

  // In turn, so each section sees what the ones before it asked (bd-5jmnfj.4.16). The note goes on
  // the section's own prompt, so a re-ask keeps it.
  const writeInTurn = async () => {
    const done = [];
    for (const b of built) {
      const asked = Prompt.askedNote(done.map((r) => r.tree));
      if (asked) {
        b.user = `${b.user}\n\n${asked}`;
        b.messages = d.sectionMessages({ system, user: b.user, pageContent: b.pageContent, model });
      }
      done.push(await writeOne(b));
    }
    return done;
  };
  const [results, oralFirst] = await Promise.all([writeInTurn(), P.oral ? writeOral(null) : null]);
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

  let oral = P.oral ? Prompt.oralContent(oralFirst.tree, P.oral, { saidCheck: P.medium !== 'ur' }) : null;
  // The oral sheet is not on the layout until the end, so it is attached to a copy for the check: a written
  // item asking an oral item's question is the written section's to fix (bd-5jmnfj.4.55).
  const withOral = (ex) => (oral ? { ...ex, _layout: { ...ex._layout, oral: { ...P.oral, content: oral.content } } } : ex);
  // A key off its word box, or a who question keyed with a sentence, is asked again like a key off its rule (bd-5jmnfj.4.57).
  const keysOff = (ex) => Prompt.answerShortfall(ex, P).concat(keyShortfall(ex, P), whoSaidShortfall(ex, loaded.content, P)); // names the book text lacks (bd-5jmnfj.4.58.2)
  const firstLaid = lay(false);
  const layoutShort = new Set(firstLaid.shortfall.map((f) => f.slot));
  const short = firstLaid.shortfall
    .concat(normaliseScheme(JSON.parse(JSON.stringify(firstLaid.examJson))).shortfall)
    .concat(d.emptyQuestionParts(firstLaid.examJson))
    .concat(Prompt.pictureShortfall(firstLaid.examJson, P))
    .concat(Prompt.repeatedPictures(firstLaid.examJson, P))
    .concat(keysOff(firstLaid.examJson))
    .concat(writtenGiveaways(answerRepeats(withOral(firstLaid.examJson))));
  const shortSlots = new Set(short.map((f) => f.slot));
  const again = built.filter(({ section }) => section.slots.some((s) => shortSlots.has(s.slot)));

  const oralHits = (ex) => answerRepeats(withOral(ex)).filter((f) => f.with.includes('oral'));
  const readAloud = P.oral ? P.oral.tasks.filter((t) => t.kind === 'read_aloud').map((t) => t.id) : [];
  const reaskOral = async (hits) => {
    const words = [...new Set(hits.flatMap((f) => f.words))];
    d.logToFile('[assessment] oral re-asked', { requestId, pattern, missing: oral.missing, giveaways: words });
    const note = [
      oral.missing.length ? `Last time these tasks came back without what they need: ${oral.missing.join(', ')}. Write every task in full.` : null,
      words.length ? `Do not use these words in the read-aloud task: ${words.join(', ')}. They are answers on the written paper.` : null,
    ].filter(Boolean).join(' ');
    const second = await writeOral(note);
    const next = Prompt.oralContent(second.tree, P.oral, { saidCheck: P.medium !== 'ur' });
    // Only the read-aloud task is swapped for a give-away; a task the first reply filled keeps it,
    // and the second reply fills the rest.
    const redo = new Set(words.length ? readAloud : []);
    const find = (from, t) => from.content.find((c) => c.id === t.id);
    const content = P.oral.tasks.map((t) => (redo.has(t.id) ? find(next, t) || find(oral, t) : find(oral, t) || find(next, t))).filter(Boolean);
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
    const note = [takenNote(MP, b.section, firstLaid.examJson, { topUp, shortfall, held: firstLaid.held }), pictures, Prompt.answerNote(shortfall, P), giveawayNote(shortfall)]
      .filter(Boolean).join('\n\n');
    const second = await writeOne(note
      ? { ...b, messages: d.sectionMessages({ system, user: `${b.user}\n\n${note}`, pageContent: b.pageContent, model }) }
      : b);
    results[i] = topUp ? { ...second, tree: d.topUp(first.tree, second.tree, new Set(shortfall.map((f) => f.slot))) } : second;
  };
  const reaskAnswers = async (b, late) => {
    const shortfall = late.filter((f) => b.section.slots.some((s) => s.slot === f.slot));
    const i = results.findIndex((r) => r.id === b.section.id);
    d.logToFile('[assessment] section re-asked', { requestId, pattern, section: b.section.id, shortfall, after: 're-ask' });
    extraUsages.push(...results[i].usages);
    const user = `${b.user}\n\n${[Prompt.answerNote(shortfall, P), giveawayNote(shortfall)].filter(Boolean).join('\n\n')}`;
    const next = await writeOne({ ...b, messages: d.sectionMessages({ system, user, pageContent: b.pageContent, model }) });
    results[i] = { ...next, tree: swapSlots(results[i].tree, next.tree, new Set(shortfall.map((f) => f.slot))) };
  };
  // A section re-asked for a repeated picture goes one at a time, so each sees the others' new pictures.
  const repeats = new Set(short.filter((f) => f.reason === 'repeat').map((f) => f.slot));
  const isRepeat = (b) => b.section.slots.some((s) => repeats.has(s.slot));
  const inTurn = async () => { for (const b of again.filter(isRepeat)) await reask(b); };
  const oralFound = oral ? oralHits(firstLaid.examJson) : [];
  await Promise.all([...again.filter((b) => !isRepeat(b)).map(reask), inTurn(), oral && (oral.missing.length || oralFound.length) ? reaskOral(oralFound) : null]);

  let laid = lay(again.length > 0);
  // The oral re-ask is checked again: a read-aloud word still given away is asked once more (v24 G1 English «cat»).
  const oralLeft = oralFound.length ? oralHits(laid.examJson) : [];
  if (oralLeft.length) await reaskOral(oralLeft);
  // A re-asked reply is checked again: v20's Section C, re-asked for Q12's repeated dog and cat, came back
  // with a Q13 about a gift (bd-5jmnfj.4.40). A key still off its rule is asked once more, and only
  // those questions are swapped in, so the rest of the section stays as it was checked.
  // The same check finds a give-away still there, and that is asked again too.
  const late = again.length
    ? keysOff(laid.examJson).concat(writtenGiveaways(stillGivenAway(withOral(laid.examJson))))
    : [];
  const reaskLate = async (flags) => {
    await Promise.all(built.filter(({ section }) => section.slots.some((s) => flags.some((f) => f.slot === s.slot)))
      .map((b) => reaskAnswers(b, flags)));
    laid = lay(true);
  };
  if (late.length) await reaskLate(late);
  // A give-away a child can see, still there after that, is asked exactly once more. A repeat never costs the
  // teacher a paper: one still there after this ships and is logged below (bd-5jmnfj.4.55).
  const lastly = late.length ? writtenGiveaways(stillGivenAway(withOral(laid.examJson))).filter((f) => f.printed) : [];
  if (lastly.length) await reaskLate(lastly);
  // A picture still repeated after those is asked once more, a section at a time so each sees the others' new
  // pictures; one still there ships and is logged below (bd-5jmnfj.4.58.2: v26 G1 English spoon in Q7 v and Q12 i).
  const stuck = Prompt.repeatedPictures(laid.examJson, P);
  for (const b of built.filter(({ section }) => section.slots.some((s) => stuck.some((f) => f.slot === s.slot)))) {
    const i = results.findIndex((r) => r.id === b.section.id);
    const mine = stuck.filter((f) => b.section.slots.some((s) => s.slot === f.slot));
    const note = Prompt.takenPicturesNote(results.filter((r) => r.id !== b.section.id).map((r) => r.tree), mine);
    d.logToFile('[assessment] section re-asked', { requestId, pattern, section: b.section.id, shortfall: mine, after: 'picture repeat' });
    extraUsages.push(...results[i].usages);
    const next = await writeOne({ ...b, messages: d.sectionMessages({ system, user: `${b.user}\n\n${note}`, pageContent: b.pageContent, model }) });
    results[i] = { ...next, tree: swapSlots(results[i].tree, next.tree, new Set(mine.map((f) => f.slot))) };
  }
  if (stuck.length) laid = lay(true);
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
  const answers = keysOff(examJson);
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
  examJson = noArrows(dealScrambles(dealOrders(examJson))); // bd-5jmnfj.4.50.1: no arrow in any text a child or teacher reads
  if (scheme.shortfall.length) {
    throw d.fail('PATTERN_SHORT_SLOT', 'A question slot came back short.', { shortfall: scheme.shortfall, examJson, model });
  }
  if (P.key === 'maths') examJson = mathsCheck(examJson, { subject: 'maths' }).examJson;
  const early = earlyEnglishFixes(earlyKeyFixes(examJson)); examJson = early.examJson; // a letter key, a word-problem key (v27, bd-5jmnfj.4.58.3)
  const slips = commonErrorNumbers(examJson); const urdu = earlyUrduFixes(slips.examJson); examJson = urdu.examJson; // a common error the numbers cannot give (v28, bd-5jmnfj.4.58.4)
  early.notes.concat(slips.notes, urdu.notes).forEach((n) => d.logToFile('[assessment] key fixed', n));

  const sectionLevels = P.sections.every((s) => s.levels) ? Object.fromEntries(P.sections.map((s) => [s.id, s.levels])) : null;
  const blueprint = checkBlueprint(examJson, { tos: P.tos || null, sectionLevels });
  examJson._layout.blueprint = blueprint;
  d.logToFile('[assessment] blueprint checked', { pattern, subject: P.key, ok: blueprint.ok, total: blueprint.total, levels: blueprint.levels, problems: blueprint.problems });
  if (P.oral) examJson = freshReadWords({ ...examJson, _layout: { ...examJson._layout, oral: { ...P.oral, content: oral.content } } }, (n) => d.logToFile('[assessment] oral word replaced', n)).examJson; // a read-aloud word the paper prints (bd-5jmnfj.4.58.4)
  // An answer word still given away after the re-ask, or by the oral sheet, is logged (bd-5jmnfj.4.50.8).
  const giveaways = answerRepeats(examJson);
  if (giveaways.length) d.logToFile('[assessment] answers given away', { requestId, pattern, giveaways });

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
