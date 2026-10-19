'use strict';
/**
 * Live moves (bd-v0toag.31): the moves a D teacher said she did that the recording check did not hear.
 * Pure. A move qualifies when her LAST tap on it is `did` and EVERY v9 move it covers came back `not_done`
 * (partial, executed, not_adjudicable or no verdict never qualify; a move covering nothing was never checked).
 * Only a note in the report: live ticks and taps never change a verdict.
 */

const list = (v) => (Array.isArray(v) ? v : []);
const text = (v) => (typeof v === 'string' && v.trim() ? v : null);

/**
 * @param {object|null} liveMoves  analysis_data.live_moves (see live-record)
 * @param {object|null} lpFidelity analysis_data.lp_fidelity — { moves: [{ move_id, verdict, text }] }
 * @param {object} [card]          the v10 card (card-store) — its move's `do` is preferred over the v9 text
 * @returns {Array<{idx:number, text:string}>}
 */
function disagreementsFor(liveMoves, lpFidelity, card) {
  if (!liveMoves || !lpFidelity) return [];
  const verdicts = new Map(list(lpFidelity.moves).map((m) => [m.move_id, m]));
  const lastTap = new Map(list(liveMoves.taps).map((t) => [t.idx, t.choice]));
  const cardDo = new Map(list(card && card.sections).flatMap((s) => list(s.moves)).map((m) => [m.idx, m.do]));
  const out = [];
  for (const m of list(liveMoves.moves)) {
    const covers = list(m.covers);
    if (lastTap.get(m.idx) !== 'did' || !covers.length) continue;
    if (!covers.every((id) => verdicts.has(id) && verdicts.get(id).verdict === 'not_done')) continue;
    const t = text(cardDo.get(m.idx)) || covers.map((id) => text(verdicts.get(id).text)).find(Boolean);
    if (t) out.push({ idx: m.idx, text: t });
  }
  return out;
}

module.exports = { disagreementsFor };
