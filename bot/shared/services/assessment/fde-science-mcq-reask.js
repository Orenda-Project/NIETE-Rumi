'use strict';
/**
 * G5 Science: a Section A MCQ that gives away a B/C answer and has no spare is re-asked alone (v37r4 panel, bd-5jmnfj.4.58).
 * dropScienceGivers kept such an item ("kept (no spare)": 2 on the v37 run). Here each kept Q1 (a) giver gets one re-ask,
 * told the words not to mention and the stems already on the paper; the first new MCQ that is not a twin and gives nothing
 * away takes its place. A failed or unclean re-ask keeps the giver, so a paper is never failed or left short.
 * `ask(note)` returns the reply tree (the service wraps the Section A write); without it nothing is asked. It asks only while
 * scienceGiverFlags still names a giver (the same flags the section re-ask reads, so a suite that stubs them asks nothing).
 */

const { dropScienceGivers, scienceGivers, scienceGiverFlags } = require('./fde-science-giveaway-drop');

const SLOT = 'science.A.Q1a';
const MOST_ASKS = 3; // lone re-asks per paper: a paper full of givers is a topic problem the section re-ask owns
const str = (v) => (typeof v === 'string' ? v : '');
const clip = (t) => str(t).replace(/\s+/g, ' ').trim().slice(0, 70);
const isMcq = (q) => q && typeof q === 'object' && Array.isArray(q.options) && q.options.length > 1;

const lists = (examJson) => ['seen', 'unseen'].flatMap((b) => Object.values((examJson && examJson[b]) || {}).flatMap((t) => Object.values(t || {}).filter(Array.isArray)));
const mcqsIn = (tree, out = []) => {
  if (Array.isArray(tree)) tree.forEach((x) => mcqsIn(x, out));
  else if (tree && typeof tree === 'object') { if (tree.slot === SLOT && isMcq(tree)) out.push(tree); else Object.values(tree).forEach((v) => mcqsIn(v, out)); }
  return out;
};

function noteFor(giver, row, stems) {
  return `Q1 (a) has one multiple-choice question that gives away another item's answer: «${clip(giver.question)}». `
    + `Write 1 new multiple-choice question for Q1 (a) to replace it, on a topic no question on the paper asks, with 4 options and one correct option. `
    + `Do not mention: ${row.words.join(', ')}.\nQuestions already on the paper (do not repeat them):\n${stems.map((s) => `- ${clip(s)}`).join('\n')}`;
}

async function replaceOne(out, row, ask, log) {
  const list = lists(out).find((l) => l.some((q) => q && q.slot === SLOT && q.question === row.question));
  if (!list) return false;
  const at = list.findIndex((q) => q && q.slot === SLOT && q.question === row.question);
  const old = list[at];
  const stems = lists(out).flat().filter((q) => q && q.slot === SLOT).map((q) => q.question);
  let tree;
  try { tree = await ask(noteFor(old, row, stems)); } catch (err) { log('[assessment] science give-away re-ask failed', { error: err.message }); return false; }
  const fits = (cand) => {
    list[at] = { ...cand, slot: SLOT, marks: cand.marks == null ? old.marks : cand.marks };
    const bad = scienceGivers(out).some((g) => g.question === cand.question);
    if (bad) list[at] = old;
    return !bad;
  };
  return mcqsIn(tree).filter((c) => !stems.includes(c.question)).some((c) => fits(JSON.parse(JSON.stringify(c))));
}

/** Returns `{examJson, dropped, kept, replaced}`, each row `{slot, question, words, with}`; the input is never changed. */
async function settleScienceGivers(examJson, { spares = [], ask = null, log = () => {} } = {}) {
  const dropped = dropScienceGivers(examJson, { spares });
  const out = dropped.examJson;
  const kept = [];
  const replaced = [];
  const live = typeof ask === 'function' && scienceGiverFlags(out).length > 0;
  for (const row of dropped.kept) {
    if (live && replaced.length < MOST_ASKS && row.slot === SLOT && await replaceOne(out, row, ask, log)) replaced.push(row);
    else kept.push(row);
  }
  if (dropped.dropped.length) log('[assessment] science give-away items taken off', { dropped: dropped.dropped });
  if (replaced.length) log('[assessment] science give-away re-asked alone', { replaced });
  if (kept.length) log('[assessment] science give-away kept (no spare)', { kept });
  return { examJson: out, dropped: dropped.dropped, kept, replaced };
}

module.exports = { settleScienceGivers };
