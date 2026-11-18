/**
 * bd-snkn32.48 — "Before they write": the close every 6–12 own plan gets, so the shelf reviewer's 5D can pass
 * ("success criteria read aloud" + "students self-predict, thumbs or traffic light, before submitting").
 *
 * The v9 format has no field for either (exit_ticket items are {q,a,ref} only), so this adds ONE `key_points` block at
 * the end of the conclusion's blocks; the renderer prints blocks before the board question and exit ticket. The
 * criteria are the plan's own objectives ("You can …"), never model text. Added after the gates accepted the rewrite,
 * by code, so it is always there and always the same.
 *
 * Placed LAST (or in place, on a repeat pass: found by its title) so no existing `ur_overlay` pointer moves. It carries
 * no `id`: lint counts every string in a block, and the conclusion has words to spare only just. When the criteria do
 * not fit the conclusion's budget, the box is one short line instead. A document with an Urdu
 * toggle gets the three Urdu strings in it; an Urdu-medium document gets them in the block itself.
 *
 * Pure: no I/O. Returns a new document; the one given is never changed.
 */

const { isScience, missingGlosses } = require('./lp612-own-gloss');

const CLOSE_TITLE = 'Before they write';
const CLOSE_TITLE_UR = 'لکھنے سے پہلے';
const READ = 'Read the success criteria aloud:';
const READ_UR = 'کامیابی کے معیار بلند آواز سے پڑھیں:';
const THUMBS_LINE = 'Before handing in the exit ticket, pupils show thumbs up (sure), sideways (unsure) or down (stuck).';
const THUMBS_LINE_UR = 'اختتامی پرچی دینے سے پہلے بچے انگوٹھا اوپر (پکا)، سیدھا (کچھ شک) یا نیچے (سمجھ نہیں آیا) دکھائیں۔';
/** One line, for a conclusion with no room for the criteria themselves. */
// bd-snkn32.50: names all three things 5D asks for (exit ticket, criteria aloud, self-prediction); the older line
// without "exit ticket"/"self-predict" got 5D>=3 on 9/14 anchor reviews, this one 11/14.
const SHORT_LINE = 'Before collecting the exit ticket, read the success criteria aloud; pupils self-predict: thumbs up, sideways or down.';
const SHORT_LINE_UR = 'اختتامی پرچی لینے سے پہلے کامیابی کے معیار بلند آواز سے پڑھیں؛ بچے انگوٹھا اوپر، سیدھا یا نیچے دکھا کر اپنا اندازہ بتائیں۔';
/** lint_lp SECTION_BUDGET_V9.conclusion (128) +30%: over it, lint fails the conclusion as "will not fit the page". */
const CONCLUSION_MAX_WORDS = 166;

const words = (s) => String(s == null ? '' : s).trim().split(/\s+/).filter(Boolean).length;
/** every string under a value, as lint_lp's harvest() counts a section's blocks. */
const allWords = (v) => (typeof v === 'string' ? words(v)
  : Array.isArray(v) ? v.reduce((n, x) => n + allWords(x), 0)
    : v && typeof v === 'object' ? Object.values(v).reduce((n, x) => n + allWords(x), 0) : 0);
/** the conclusion's words as lint_lp counts them: its blocks plus the board question, exit ticket and re-teach rule. */
function conclusionWords(sec) {
  const c = sec.checkpoint || {};
  return allWords(sec.blocks) + words(c.question) + allWords(c.mark_scheme || [])
    + (sec.exit_ticket || []).reduce((n, x) => n + words(x && x.q) + words(x && x.a), 0) + words(sec.reteach_rule);
}

const fullItems = (texts, read, thumbs) => {
  const t = texts.map((x) => String(x || '').trim()).filter(Boolean);
  return t.length ? [`${read} ${t.join(' ')}`, thumbs] : null;
};

function addCloseStep(doc) {
  if (!doc || !Array.isArray(doc.sections)) return doc;
  const si = doc.sections.findIndex((s) => s && s.id === 'conclusion');
  if (si < 0) return doc;
  const out = JSON.parse(JSON.stringify(doc));
  const sec = out.sections[si];
  const blocks = Array.isArray(sec.blocks) ? sec.blocks : [];
  sec.blocks = blocks;
  const items = (out.objectives && Array.isArray(out.objectives.items)) ? out.objectives.items : [];
  const urduMedium = out.provenance && out.provenance.medium === 'ur';
  const at = blocks.findIndex((b) => b && b.type === 'key_points' && [CLOSE_TITLE, CLOSE_TITLE_UR].includes(b.title));
  const bi = at >= 0 ? at : blocks.length;
  // the room left, without any box of ours already there
  const room = CONCLUSION_MAX_WORDS - conclusionWords({ ...sec, blocks: blocks.filter((_, i) => i !== at) });
  const title = urduMedium ? CLOSE_TITLE_UR : CLOSE_TITLE;
  const full = fullItems(items.map((o) => o && o.text), urduMedium ? READ_UR : READ, urduMedium ? THUMBS_LINE_UR : THUMBS_LINE);
  const fits = (its) => its && allWords({ type: 'key_points', title, items: its }) <= room;
  const short = fits(full) ? null : [urduMedium ? SHORT_LINE_UR : SHORT_LINE];
  blocks[bi] = { type: 'key_points', title, items: short || full };

  const ov = out.ur_overlay;
  if (!urduMedium && ov && typeof ov === 'object' && !Array.isArray(ov)) {
    const base = `/sections/${si}/blocks/${bi}`;
    for (const k of Object.keys(ov)) if (k.startsWith(`${base}/`)) delete ov[k];
    const ur = items.map((o, i) => ov[`/objectives/items/${i}/text`]);
    ov[`${base}/title`] = CLOSE_TITLE_UR;
    const urFull = ur.length && ur.every(Boolean) ? fullItems(ur, READ_UR, THUMBS_LINE_UR) : null;
    const urItems = short ? [SHORT_LINE_UR] : (urFull || [`${READ_UR} «آپ…» جملے، سیکھنے کے نتائج کے خانے سے۔`, THUMBS_LINE_UR]);
    urItems.forEach((t, i) => { ov[`${base}/items/${i}`] = t; });
  }
  return out;
}

/**
 * bd-snkn32.50 — the close taken back out (box + its Urdu toggle entries), for a lesson it would push over the page cap.
 * The box is always last in the conclusion's blocks, so no other pointer moves. `null` when there is no box. Pure.
 */
function removeCloseStep(doc) {
  const si = doc && Array.isArray(doc.sections) ? doc.sections.findIndex((s) => s && s.id === 'conclusion') : -1;
  const blocks = si >= 0 && Array.isArray(doc.sections[si].blocks) ? doc.sections[si].blocks : [];
  const bi = blocks.findIndex((b) => b && b.type === 'key_points' && [CLOSE_TITLE, CLOSE_TITLE_UR].includes(b.title));
  if (bi < 0 || bi !== blocks.length - 1) return null;   // not last: taking it out would move later pointers
  const out = JSON.parse(JSON.stringify(doc));
  out.sections[si].blocks.splice(bi, 1);
  const ov = out.ur_overlay;
  if (ov && typeof ov === 'object' && !Array.isArray(ov)) {
    for (const k of Object.keys(ov)) if (k.startsWith(`/sections/${si}/blocks/${bi}/`)) delete ov[k];
  }
  return out;
}

/**
 * The worker's one call after the gates accept her 6–12 rewrite: the close step, and for Science a count of key words
 * the model left without Urdu (bd-snkn32.48's counter; logged, never fails her plan).
 */
function finishOwnDoc(doc, segment, log) {
  const seg = segment || {};
  if (isScience({ subject: seg.subject, segmentId: seg.segment_id })) {
    const missing = missingGlosses(doc);
    if (missing.length && log) log('LP 6-12 own: Science key words without Urdu', { segmentId: seg.segment_id, missing: missing.length });
  }
  return addCloseStep(doc);
}

module.exports = {
  addCloseStep, removeCloseStep, finishOwnDoc, conclusionWords, CLOSE_TITLE, CLOSE_TITLE_UR, THUMBS_LINE, THUMBS_LINE_UR, SHORT_LINE, SHORT_LINE_UR,
  CONCLUSION_MAX_WORDS,
};
