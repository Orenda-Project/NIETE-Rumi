'use strict';
/**
 * bd-ptl6x9.7 — which maths skill a school+grade found hardest, and the Jugnu game that practises it. Pure.
 *
 *   pick(results, links)  results: [{egma, scored, passing}] for ONE school+grade (children, not attempts);
 *                         links: links.json. → {egma, game} | null.
 *
 * Rules, in order: only tasks the knowledge graph links to a game; a task with fewer than MIN_GROUP scored
 * children is not spoken about at all; a task is named only when its pass share is under its link's `below`;
 * the lowest share wins; a tie goes to the links' own order. The answer carries no count and no rate, so a
 * message built from it cannot print one.
 */

const MIN_GROUP = 5;

const whole = (n) => Number.isInteger(n) && n >= 0;

function pick(results, links) {
  if (!Array.isArray(results) || !links || !Array.isArray(links.links)) return null;
  const byTask = new Map();
  for (const r of results) {
    if (r && whole(r.scored) && whole(r.passing) && r.passing <= r.scored) byTask.set(r.egma, r);
  }
  let best = null;
  links.links.forEach((link, order) => {
    const r = byTask.get(link.egma);
    if (!r || r.scored < MIN_GROUP) return;
    const share = r.passing / r.scored;
    if (!(share < link.below)) return;
    if (!best || share < best.share || (share === best.share && order < best.order)) best = { link, share, order };
  });
  return best ? { egma: best.link.egma, game: best.link.game } : null;
}

module.exports = { pick, MIN_GROUP };
