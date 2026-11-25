'use strict';
/**
 * bd-snkn32.77 (queue #296) — a grades 1-5 "Make my own" plan the gate still refuses after its repair round ends her
 * row failed. Before this, every such row said only "Couldn't make it". The code names the rule the plan kept
 * breaking, so the waiting page can tell her what to change (tick Board, try another teaching way, try again).
 *
 * Pure: no I/O. `reasons` are checkK5Rewrite's / repairOnly's strings from the last round.
 */
const KINDS = [
  [/^uses a board she does not have/, 'OWN_NEEDS_BOARD'],
  [/^uses slates/, 'OWN_SLATES'],
  [/^You Do has pair or group work/, 'OWN_GROUP_WORK'],
  [/^not in Urdu/, 'OWN_NOT_URDU'],
];

/** The first reason she can act on, as an error code; anything else (a broken reply, a changed goal) NOT_ACCEPTED. */
function refusalCode(reasons) {
  for (const r of Array.isArray(reasons) ? reasons : []) {
    const hit = KINDS.find(([re]) => re.test(String(r)));
    if (hit) return hit[1];
  }
  return 'NOT_ACCEPTED';
}

module.exports = { refusalCode, CODES: KINDS.map(([, c]) => c) };
