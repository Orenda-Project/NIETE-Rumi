'use strict';
/**
 * Class H — a user-facing string missing one of the offered languages does not
 * fail. It silently degrades to English, for exactly the users who chose not to
 * read English.
 *
 * The refusals added for row 122 are the first thing a teacher sees when she
 * taps the feature that is not hers, so they are the worst possible place to
 * fall back. NIETE offers ["ur","en"].
 *
 * This iterates LANGUAGE_OFFER rather than asserting an en/ur pair: a hardcoded
 * list stops checking the moment a language is added, which is the failure the
 * class describes.
 */
const fs = require('fs');
const path = require('path');
const { LANGUAGE_OFFER } = require('../../bot/shared/config/languages');

const SRC = fs.readFileSync(
  path.join(__dirname, '../../bot/shared/services/menu.service.js'), 'utf8');

/** The ROLE_REFUSAL literal, read from source — no bot deps to boot. */
function refusals() {
  const start = SRC.indexOf('const ROLE_REFUSAL');
  expect(start).toBeGreaterThan(-1);
  const block = SRC.slice(start, SRC.indexOf('\n});', start));
  const out = {};
  for (const kind of ['dc', 'observe']) {
    const at = block.indexOf(`${kind}: Object.freeze({`);
    expect(at).toBeGreaterThan(-1);
    const seg = block.slice(at, block.indexOf('}),', at));
    out[kind] = Object.fromEntries(
      [...seg.matchAll(/(\w+):\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => [m[1], m[2]]));
  }
  return out;
}

describe('row 122 — the role refusals speak every offered language', () => {
  test('the offer itself is non-empty (else every assertion below is vacuous)', () => {
    expect(LANGUAGE_OFFER.length).toBeGreaterThan(1);
  });

  test.each(['dc', 'observe'])('%s refusal covers the whole LANGUAGE_OFFER', (kind) => {
    const map = refusals()[kind];
    const missing = LANGUAGE_OFFER.filter(
      (l) => typeof map[l] !== 'string' || !map[l].trim());
    expect(missing).toEqual([]);
  });

  test('the Urdu copy is actually Urdu, not English sitting in the ur slot', () => {
    for (const kind of ['dc', 'observe']) {
      expect(/[؀-ۿ]/.test(refusals()[kind].ur)).toBe(true);
    }
  });

  test('each refusal names the row that IS hers, so she is redirected, not just refused', () => {
    const r = refusals();
    for (const l of LANGUAGE_OFFER) {
      expect(r.dc[l]).toMatch(/Observe a Teacher/);
      expect(r.observe[l]).toMatch(/Classroom Coaching/);
    }
  });

  test('every refusal fits a WhatsApp body, measured in CODE POINTS', () => {
    const r = refusals();
    for (const kind of ['dc', 'observe']) {
      for (const l of LANGUAGE_OFFER) {
        expect([...r[kind][l]].length).toBeLessThanOrEqual(1024);
      }
    }
  });
});
