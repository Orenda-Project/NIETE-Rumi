'use strict';

/**
 * /observe2 — a second look at each moment's label, after the quote check and before the coach sees it
 * (bd-eal7zn.8).
 *
 * The quote check makes sure the words were said; it cannot tell whether they show what the label
 * claims. With prompt v2, about 1 in 3 moments still carried a label its words do not show (a closed
 * question as "open question", an instruction as "a real choice"; by hand, 0 of 17 "children led a part"
 * were real), and a coach who answers "yes, this happened" to real words lets rules.js count the label.
 *
 * One batched call per visit, through the moments call's own seam (same job, same model): each moment's
 * quote, its claimed type, the lines around it in the transcript, and the type definitions the moments
 * prompt uses (moment-types.js). The reply is keep, relabel (to one of the existing types) or drop, and
 * the code enforces it:
 *
 *   kept             the verdict was keep (or a relabel to the type it already had)
 *   relabelled       a relabel to a real type whose speaker rule the words pass (quote-check.speakerAllows)
 *   dropped          the verdict was drop
 *   relabel_invalid  a relabel to something that is not a type: dropped, the label was judged wrong
 *   relabel_speaker  a relabel to a type the words' speaker cannot do: dropped
 *   missing          no verdict came back for the moment: kept as it was
 *
 * A call that throws, is cut off at the output limit, or comes back without verdicts changes nothing: the
 * moments go to the coach as the quote check left them, and the failure is logged at error by the caller.
 */

const { TYPES, GROUP_OF, TYPE_GUIDE } = require('./moment-types');
const { parseTranscript, speakerAllows, rolesOf, contextOf, clock } = require('./quote-check');
const { clampLanguage } = require('../../../config/ux-strings');
const { getLanguage } = require('../../../config/languages');

const MAX_TOKENS = 16000;
const WHY_MAX = 120;
const LINE_MAX = 400;
const LABEL_OF = Object.fromEntries(Object.values(TYPES).flatMap((g) => Object.entries(g)));

const clip = (text, max) => { const cps = [...String(text || '')]; return cps.length > max ? `${cps.slice(0, max - 1).join('')}…` : cps.join(''); };

function contextLines(quote, lines) {
  const around = contextOf(quote, lines);
  if (!around.length) return ['(not found in the transcript)'];
  return around.map((l) => `[${clock(l.sec)}] ${l.speaker}: ${clip(l.rawWords.join(' '), LINE_MAX)}`);
}

function buildLabelPrompt(moments, lines, { lang } = {}) {
  const L = getLanguage(clampLanguage(lang));
  const why = [
    `For a relabel, also give "why": one short sentence, at most 15 words, in ${L.languageDescription}, on what the`,
    'moment shows about the teaching or the children\'s learning. Say "the teacher", "the child" or "the children";',
    'never "he" or "she".',
  ];
  if (L.direction === 'rtl') {
    why.push(`Write it in ${L.languageDescription} script (${L.script}), never in Roman letters, so that no verb shows whether the`,
      'teacher or a child is a man or a woman.');
  }
  return [
    'You are checking the labels on moments that were picked from one classroom lesson for a coach. A coach who',
    'confirms a moment lets its label count toward the teacher\'s levels, so a wrong label changes a teacher\'s result.',
    '',
    'Each moment has its TYPE, its QUOTE (for a question and its answer: question — answer) and the transcript lines',
    'around it. Decide, from the words alone, whether they show exactly what the type says:',
    '- keep: the words clearly show this type.',
    '- relabel: the words clearly show a different type from the list below. Give that type.',
    '- drop: the words show no type in the list (a closed question, an instruction, admin, a single word, a moral),',
    '  or you cannot tell. When unsure, drop.',
    '',
    'STRICT, because these two were wrong almost every time they were picked:',
    '- handover ("children led a part"): keep it only if a child runs part of the lesson for the whole class: leads',
    '  it, asks the class questions, or explains to the class. A child answering, reading aloud, writing on the board',
    '  or doing the task they were given, and children working in pairs or groups as they were told, are never this.',
    '- choice ("a real choice"): keep it only if the children themselves decide something that matters (which task,',
    '  how to show their work, who to work with) and then act on it. An instruction to work in pairs or groups,',
    '  picking which of two words to say, or homework is never this.',
    '',
    'THE TYPES',
    ...TYPE_GUIDE,
    '',
    ...why,
    '',
    'Return JSON only, one verdict per moment, in this shape:',
    '{"verdicts":[{"n":1,"verdict":"keep|relabel|drop","type":"<the new type, for a relabel>","why":"<for a relabel>"}]}',
    '',
    'MOMENTS',
    ...moments.flatMap((m, i) => [
      `### ${i + 1}`,
      `TYPE: ${m.type} (${LABEL_OF[m.type] || m.type})`,
      `QUOTE: ${m.quote}`,
      'CONTEXT:',
      ...contextLines(m.quote, lines),
      '',
    ]),
  ].join('\n');
}

// A reply as completeJson gives it ({result, usage}); a seam that hands back the bare JSON has no usage.
function unwrap(reply) {
  if (reply && typeof reply === 'object' && 'result' in reply && 'usage' in reply) return reply;
  return { result: reply, usage: null };
}

const fresh = (checked) => ({ status: 'ok', checked, kept: 0, relabelled: 0, dropped: 0, relabel_invalid: 0, relabel_speaker: 0, missing: 0 });

/**
 * @param {Array} moments  as the quote check left them ({moment, type, minute, quote, why})
 * @param {{transcript: string, lang?: string, llm: Function}} opts  llm: (prompt, {maxTokens}) => completeJson reply
 * @returns {Promise<{moments: Array, stats: object}>}
 */
async function checkLabels(moments, { transcript, lang, llm } = {}) {
  const list = Array.isArray(moments) ? moments : [];
  if (!list.length) return { moments: list, stats: { ...fresh(0), status: 'skipped' } };
  const lines = parseTranscript(transcript);
  const failed = (reason) => ({ moments: list, stats: { ...fresh(list.length), status: 'failed', reason } });

  let result;
  try {
    const { result: r, usage } = unwrap(await llm(buildLabelPrompt(list, lines, { lang }), { maxTokens: MAX_TOKENS }));
    if (usage && Number(usage.completion_tokens) >= MAX_TOKENS) return failed('cut_off at the output limit');
    result = r;
  } catch (err) {
    return failed(`error: ${String((err && err.message) || err).slice(0, 200)}`);
  }
  if (!result || !Array.isArray(result.verdicts)) return failed('unreadable: no verdicts in the reply');

  const byN = new Map();
  for (const v of result.verdicts) if (v && Number.isInteger(Number(v.n))) byN.set(Number(v.n), v);
  const stats = fresh(list.length);
  const out = [];
  list.forEach((m, i) => {
    const v = byN.get(i + 1);
    const verdict = v && String(v.verdict || '').trim().toLowerCase();
    if (!v || !['keep', 'relabel', 'drop'].includes(verdict)) { stats.missing += 1; out.push(m); return; }
    if (verdict === 'drop') { stats.dropped += 1; return; }
    const type = verdict === 'relabel' ? String(v.type || '').trim() : m.type;
    if (type === m.type) { stats.kept += 1; out.push(m); return; }
    if (!GROUP_OF[type]) { stats.relabel_invalid += 1; return; }
    if (!speakerAllows(type, rolesOf(m.quote, lines))) { stats.relabel_speaker += 1; return; }
    stats.relabelled += 1;
    out.push({ ...m, moment: GROUP_OF[type], type, why: clip(String(v.why || '').replace(/\s+/g, ' ').trim(), WHY_MAX) });
  });
  return { moments: out, stats };
}

module.exports = { checkLabels, buildLabelPrompt, MAX_TOKENS };
