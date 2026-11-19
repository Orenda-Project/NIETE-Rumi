'use strict';
/**
 * What My journey and the team's "Where teachers get to" answer, from the stored activity values
 * (docs/teacher-activity-store.md). Pure: no Redis, no database — the routes read the store and hand the values here.
 *
 *   journeySteps(value)                 her stored steps for the page, newest first, camelCased
 *   inScope(who, scope)                 whether an analytics account may see this roster entry: its own organization's
 *                                       teachers; the default organization (scope.keepsUnplaced) also keeps the
 *                                       teachers no region places, as every analytics tab does
 *   teamView(team, scope, { region })   Primary (grades 1-5) teachers in scope: per rung, reached = this rung or later,
 *                                       stopped = exactly here; tracked; and the rung after the largest drop
 *   stoppedAt(team, scope, step, ...)   the teachers who stopped at one rung, oldest last step first
 *   parseRegion(scope, raw)             ?region= — blank/all, or one of the view's regions
 * A teacher whose band is 'g612' is not on the Primary view; one with no band is (lp-engagement's "else Primary").
 */
const { TEAM_STEPS } = require('../../bot/shared/config/teacher-activity-contract');

const key = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

function journeySteps(value) {
  const steps = value && Array.isArray(value.journey) ? value.journey : [];
  return steps.map((s) => ({ kind: s.kind, at: s.at, refId: s.ref_id, meta: s.meta }));
}

function inScope(who, scope) {
  if (!who || !scope) return false;
  return who.org ? who.org === scope.organization : scope.keepsUnplaced === true;
}

function parseRegion(scope, raw) {
  const k = key(raw);
  if (!k || k === 'all') return { ok: true, region: null };
  const region = (scope.regions || []).find((r) => key(r) === k);
  return region ? { ok: true, region } : { ok: false };
}

/** [id, entry] of the Primary teachers in scope (and in `region` when given). */
function tracked(team, scope, region) {
  const roster = team && team.teachers && typeof team.teachers === 'object' ? team.teachers : {};
  return Object.entries(roster).filter(([, w]) => inScope(w, scope) && w.band !== 'g612'
    && (!region || key(w.region) === key(region)));
}

function teamView(team, scope, { region = null } = {}) {
  const list = tracked(team, scope, region);
  const stopped = Object.fromEntries(TEAM_STEPS.map((s) => [s, 0]));
  for (const [, w] of list) if (stopped[w.furthest] !== undefined) stopped[w.furthest] += 1;
  let reached = list.length;
  const steps = TEAM_STEPS.map((step) => {
    const row = { step, reached, stopped: stopped[step] };
    reached -= stopped[step];
    return row;
  });
  let largestDrop = null; let drop = 0;
  for (let i = 1; i < steps.length; i += 1) {
    const d = steps[i - 1].reached - steps[i].reached;
    if (d > drop) { drop = d; largestDrop = steps[i].step; }
  }
  return { tracked: list.length, steps, largestDrop };
}

function stoppedAt(team, scope, step, { region = null } = {}) {
  if (!TEAM_STEPS.includes(step)) return [];
  const at = (w) => (w.last_at ? Date.parse(w.last_at) : -Infinity);
  return tracked(team, scope, region)
    .filter(([, w]) => w.furthest === step)
    .sort(([, a], [, b]) => at(a) - at(b))
    .map(([id, w]) => ({ id, name: w.name, school: w.school, lastKind: w.last_kind, lastAt: w.last_at }));
}

module.exports = { journeySteps, inScope, teamView, stoppedAt, parseRegion, TEAM_STEPS };
