'use strict';
/**
 * Prompt loader for grades 6-12 (G612 prompts contract, contract.md §3-§4).
 *
 * Pure: reads ict-prompts.json and nothing else. It only ever returns the G6-12 keys appended to
 * that file; asking for a G1-5 key, or any key that is not there, throws PROMPT_KEY_MISSING. There
 * is no fallback to another band, to `eg.ict.<canon>.system` or to the English prompt.
 */

const PROMPTS = require('./ict-prompts.json');

// The 13 G1-5 keys, in file order. They are never returned from here.
const PRIMARY_KEYS = new Set(Object.keys(PROMPTS).slice(0, 13));
const PLACEHOLDER = /\{([a-z_]+)\}/g;
const LEGEND = { K: 'Knowledge', R: 'Remember', U: 'Understand', A: 'Apply', AE: 'Analyse/Evaluate', C: 'Create' };

function fail(code, extra) {
  const err = new Error(`${code}: ${JSON.stringify(extra)}`);
  return Object.assign(err, { code }, extra);
}

function promptFor(key) {
  if (PRIMARY_KEYS.has(key) || typeof PROMPTS[key] !== 'string') throw fail('PROMPT_KEY_MISSING', { key });
  return PROMPTS[key];
}

/** Replace every {name} in the text from values; a name with no value throws. JSON braces never match. */
function fill(key, text, values) {
  const vals = values || {};
  return text.replace(PLACEHOLDER, (m, name) => {
    const v = vals[name];
    if (v === undefined || v === null) throw fail('PROMPT_PLACEHOLDER_UNFILLED', { key, name });
    return String(v);
  });
}

/** level_scale / level_legend / level_split / tolerance_pp from a ToS `{levels, tolerance_pp}`. */
function levelValues(tos) {
  const letters = Object.keys(tos.levels);
  return {
    level_scale: letters.join('/'),
    level_legend: letters.map((l) => `${l} ${LEGEND[l]}`).join(', '),
    level_split: letters.map((l) => `${l} ${tos.levels[l]}`).join(' / '),
    tolerance_pp: tos.tolerance_pp,
  };
}

/**
 * The system string for one call: the cell's system key, the secondary format, the Urdu format for
 * an Urdu-medium cell, the board-section task in board mode, and the safety key last. Parts are
 * filled from `values` and joined with a blank line.
 */
function assemble({ row, kind = 'free', values }) {
  if (kind !== 'free' && kind !== 'board') throw fail('PROMPT_KIND_UNKNOWN', { kind });
  const keys = [
    row.prompt_key,
    'eg.format.secondary',
    ...(row.medium === 'ur' ? ['eg.format.secondary_urdu'] : []),
    ...(kind === 'board' ? ['eg.task.board_section'] : []),
    'eg.safety.policies.6_12',
  ];
  return keys.map((key) => fill(key, promptFor(key), values)).join('\n\n');
}

module.exports = { promptFor, fill, assemble, levelValues };
