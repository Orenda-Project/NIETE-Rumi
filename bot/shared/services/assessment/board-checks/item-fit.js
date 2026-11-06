'use strict';
/**
 * D19/D20 item-fit (bd-5jmnfj.38.30 round 10), soft. From blind-panel 2s on a G9 physics paper:
 *  D19 STIMULUS_UNUSED: an item in a stimulus group that never uses the stimulus (no shared number, no reference
 *      cue, fewer than minShared shared content words): stand-alone recall inside a scenario block.
 *  D20 GRAPH_SLO_NO_GRAPH: an item stamped with a graph/gradient SLO (chapter map wording) that shows or asks for
 *      no graph. Reads the static slo-map; no other I/O. Pure.
 */
const { leaves } = require('./walk');
const { issue } = require('./common');
const { tokens } = require('./_text-norm');
const Slo = require('../slo-map');

const LIMITS = { minShared: 2, minWordLen: 4 };
const ID = 'D19/D20';
const CUE = /\b(?:passage|scenario|above|below|table|graph|data|figure|diagram|experiment|readings?|shown|described|stated|mentioned|according to)\b/i;
const GRAPH_SLO = /graph|gradient|\bvs\b|speed-time|distance-time|velocity-time/i;
const GRAPH_ITEM = /graph|gradient|slope|plot|axis|axes|speed-time|distance-time|velocity-time|figure|diagram/i;
const STOP = new Set('that this these those with from what which when where while there their they them have will would about into than then each other given'.split(' '));

const textOf = (item) => [item.question, ...(Array.isArray(item.options) ? item.options : [])].filter(Boolean).join(' ');
const content = (s) => new Set(tokens(s).filter((w) => w.length >= LIMITS.minWordLen && !STOP.has(w) && !/^\d/.test(w)));
const numbers = (s) => new Set((String(s).match(/\d+(?:\.\d+)?/g) || []));

function usesStimulus(item, stim) {
  const q = String(item.question || '');
  if (CUE.test(q)) return true;
  const nums = numbers(stim);
  if ([...numbers(q)].some((n) => nums.has(n))) return true;
  const sw = content(stim);
  return [...content(textOf(item))].filter((w) => sw.has(w)).length >= LIMITS.minShared;
}

function graphCodes(sc) {
  const ch = sc && sc.grade != null ? Slo.chaptersFor(sc.grade, sc.code) : null;
  const out = new Set();
  Object.values((ch && ch.chapters) || {}).forEach((list) => (list || []).forEach((x) => { if (x.kind === 'official' && GRAPH_SLO.test(x.desc || '')) out.add(x.code); }));
  return out;
}

function run(examJson, ctx) {
  const out = [];
  const graphs = graphCodes(ctx && ctx.subjectConfig);
  leaves(examJson).forEach(({ item, ref, slot, stimulus }) => {
    const push = (rule, msg) => out.push(issue(ID, rule, ref, msg, false, slot == null ? undefined : slot));
    if (stimulus && !usesStimulus(item, stimulus)) push('STIMULUS_UNUSED', 'this item can be answered without the stimulus');
    const slo = item.tag && item.tag.official_slo;
    if (slo && graphs.has(slo) && !GRAPH_ITEM.test(`${textOf(item)} ${stimulus || ''}`) && !item.figure) push('GRAPH_SLO_NO_GRAPH', `${slo} is a graph outcome but the item has no graph`);
  });
  return { ok: true, issues: out };
}

module.exports = { id: ID, name: 'item-fit', hard: false, modes: ['board'], LIMITS, run };
