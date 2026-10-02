'use strict';

/**
 * The other lanes' modules, as the conversation sees them (CONTRACT §5, lanes/L3/STORE_API.md).
 *
 *   draw, store   L3   ../draw, ../store
 *   scoring       L5   ../scoring          scoreBlock({ sessionId, block, grade, form })
 *   checkFlow     L6   ../check-flow       sendCheck(sessionId)
 *   render        L2   ../render           renderInlineCards({ grade, form, block, variant })
 *   itemBank      L1   ../item-bank        cue phrases
 *
 * Each is required lazily. A module that is not on this branch yet resolves to a stand-in that
 * FAILS LOUDLY in the result (ok:false / false / throw) — never a silent success — so a deploy
 * missing a lane shows the coach a save failure instead of pretending. Tests inject contract fakes
 * with __setForTest.
 */

const { logError } = require('../../../utils/logger');

const notLanded = (lane) => async () => ({ ok: false, error: `${lane}_not_landed` });

const STAND_INS = {
  draw: { todaysList: notLanded('draw'), markOutcome: notLanded('draw'), resolveVisitSchool: notLanded('draw') },
  store: new Proxy({}, { get: () => notLanded('store') }),
  scoring: { scoreBlock: async () => ({ ok: false, aiStatus: 'failed', reason: 'scoring_not_landed' }) },
  checkFlow: { sendCheck: async () => false },
  render: { renderInlineCards: async () => { throw new Error('render_not_landed'); } },
  itemBank: {},
};

const PATHS = {
  draw: '../draw',
  store: '../store',
  scoring: '../scoring',
  checkFlow: '../check-flow',
  render: '../render',
  itemBank: '../item-bank',
};

let injected = null;
const cache = {};

function load(name) {
  if (injected && injected[name]) return injected[name];
  if (cache[name]) return cache[name];
  try {
    cache[name] = require(PATHS[name]);
  } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND' || !String(err.message).includes(PATHS[name].slice(3))) throw err;
    logError('child_test.lane_module_missing', { module: name });
    cache[name] = STAND_INS[name];
  }
  return cache[name];
}

const DEFAULT_CUES = { urdu: 'شروع', english: 'start', maths: 'شروع' };

function bankCues() {
  const bank = load('itemBank');
  let cue = typeof bank.cue === 'function' ? bank.cue() : bank.cue;
  if (!cue && typeof bank.getBank === 'function') cue = (bank.getBank() || {}).cue;
  if (!cue && bank.bank) cue = bank.bank.cue;
  return cue || {};
}

/** The spoken start cue for a block, from the item bank (CONTRACT §2 `cue`), else the defaults. */
function cueFor(block) {
  try {
    const start = (bankCues()[block] || {}).start;
    return start || DEFAULT_CUES[block];
  } catch (err) {
    return DEFAULT_CUES[block];
  }
}

/** A section cue (CONTRACT §10 CR-4, e.g. maths.numbers), or null when the bank has none. */
function sectionCueFor(block, section) {
  try {
    const v = (bankCues()[block] || {})[section];
    return typeof v === 'string' && v.trim() ? v : null;
  } catch (err) {
    return null;
  }
}

/** Quick-sums seconds (CONTRACT §2 maths.quick_sums_seconds, sandbox override): the one setting. */
function quickSumsSeconds(grade, form) {
  try {
    const bank = load('itemBank');
    if (typeof bank.quickSumsSeconds === 'function') return bank.quickSumsSeconds(grade, form);
    return require('../item-bank').quickSumsSeconds(grade, form);
  } catch (err) {
    logError('child_test.quick_sums_seconds_failed', { error: err.message });
    return 60;
  }
}

module.exports = {
  get draw() { return load('draw'); },
  get store() { return load('store'); },
  get scoring() { return load('scoring'); },
  get checkFlow() { return load('checkFlow'); },
  get render() { return load('render'); },
  cueFor,
  sectionCueFor,
  quickSumsSeconds,
  __setForTest(fakes) { injected = fakes; },
};
