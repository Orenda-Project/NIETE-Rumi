'use strict';
/**
 * D18 key-cue (bd-5jmnfj.38.30 round 10): an MCQ whose key stands out. A blind psychometrician marked the key
 * that is the longest option, or that carries "always"/"never", as a test-wise giveaway. Deterministic.
 * Hard: KEY_LONGEST (key body >= ratio x and >= minGap chars longer than every distractor), KEY_ABSOLUTE.
 * Soft: DISTRACTOR_ABSOLUTE. All-number options are never length-checked. Pure.
 */
const { leaves } = require('./walk');
const { issue } = require('./common');
const T = require('./option-text');

const LIMITS = { ratio: 1.5, minGap: 12 };
const ID = 'D18';
const ABSOLUTE = /\b(?:always|never)\b/i;

function run(examJson) {
  const out = [];
  leaves(examJson).forEach(({ item, ref, slot }) => {
    if (!Array.isArray(item.options) || item.options.length < 2) return;
    const k = T.keyIndex(item);
    if (k < 0) return;
    const push = (rule, msg, hard) => out.push(issue(ID, rule, ref, msg, hard, slot == null ? undefined : slot));
    const bodies = item.options.map((o) => T.body(o).trim());
    const len = bodies.map((b) => b.length);
    const other = Math.max(...len.filter((_, i) => i !== k));
    const numeric = item.options.every((o) => T.parseNumber(T.stripLabel(o)) !== null);
    if (!numeric && len[k] >= LIMITS.ratio * other && len[k] - other >= LIMITS.minGap) push('KEY_LONGEST', `key is ${len[k]} chars, longest distractor ${other}`, true);
    if (ABSOLUTE.test(bodies[k])) push('KEY_ABSOLUTE', 'the key says always/never', true);
    else if (bodies.some((b, i) => i !== k && ABSOLUTE.test(b))) push('DISTRACTOR_ABSOLUTE', 'a distractor says always/never', false);
  });
  return { ok: !out.some((i) => i.hard), issues: out };
}

module.exports = { id: ID, name: 'key-cue', hard: true, modes: ['board'], LIMITS, run };
