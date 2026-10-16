'use strict';
/**
 * The web quiz's own paths: a module list beside a query golden (the *.modules.json files) is compared only inside
 * these prefixes. Inside them it is an exact list (a read added in one of our modules moves a golden, so the train tool
 * must see it); outside them it is silent (another team's module a gate happens to load says nothing about our goldens,
 * and differs between trees).
 */
const OWNED = [
  'bot/shared/services/quiz/',
  'bot/shared/services/child-test/',
  'bot/shared/config/copy',
  'bot/shared/templates/class-round',
  'bot/shared/templates/teacher-jugnu',
  'dashboard/public/wq/',
  'scripts/web-quiz/',
];

/** The sorted, de-duplicated repo paths of `paths` that sit under one of OWNED. */
function ownedOnly(paths) {
  return [...new Set((paths || []).filter((p) => OWNED.some((pre) => String(p).startsWith(pre))))].sort();
}

module.exports = { OWNED, ownedOnly };
