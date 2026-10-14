/**
 * v10 coaching test (bd-v0toag.22): the high-leverage practice a plan move carries, as a FICO
 * section C code (frameworks/fico-framework.js).
 *
 * A move's id (m1..mN) only means something inside its own lesson, and move texts never repeat, so
 * the check on the next recording (a different lesson) looks for a move with the same practice.
 * The tag is computed from the move's phase, type and text (niete_lp_fidelity_moves, and the copy
 * the grader stores on the session): no table, no content edit. First rule that matches wins; the
 * text rules read English only, so an Urdu move falls through to its phase and type. Pure.
 */

const PRACTICES = {
  C1: 'Quality Questioning',
  C3: 'Effective Feedback',
  C4: 'Equitable Participation',
  C6: 'Classroom Management & Routines',
  C8: 'Modeling, Scaffolding & Problem-Solving',
  C9: 'Collaborative Learning',
  C11: 'Self & Peer Assessment Facilitation',
};

const PEER_CHECK = /each other|\bswap|self[- ]?check|\bpeer/;
const COLLABORATE = /\bpairs?\b|\bpartners?\b|\bgroups?\b|\bteams?\b|\bneighbou?rs?\b|\bturn to\b/;
const ALL_RESPOND = /choral|chorus|cold call|by name|every child/;
const MODEL = /think[- ]aloud|\bmodel/;

const BY_PHASE = {
  warm_up: 'C1', recall: 'C1', hook: 'C1',
  explain: 'C8', guided: 'C8',
  independent: 'C3', exit: 'C3',
  announce: 'C6',
};

function practiceTag(move) {
  if (!move || typeof move !== 'object') return null;
  const phase = String(move.phase || '').toLowerCase();
  const type = String(move.type || '').toLowerCase().split(/[\s+/]+/)[0];
  const text = String(move.text || '').toLowerCase();

  if (phase === 'peer_review' || PEER_CHECK.test(text)) return 'C11';
  if (phase === 'grouping' || COLLABORATE.test(text)) return 'C9';
  if (ALL_RESPOND.test(text)) return 'C4';
  if (type === 'modelling' || MODEL.test(text)) return 'C8';
  if (phase === 'exit' || type === 'check') return 'C3';
  if (type === 'question') return 'C1';
  return BY_PHASE[phase] || null;
}

module.exports = { practiceTag, PRACTICES };
