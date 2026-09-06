/**
 * Meta refuses a screen whose payload is missing a key the Flow JSON declares.
 * The teacher sees "Something went wrong" — no error reaches our logs, because
 * nothing on our side failed: the endpoint answered 200 with a well-formed
 * screen, and the CLIENT rejected it.
 *
 * That is what happened on 5 Sep to the review layer, on BOTH staging and
 * production. KEEP declared `keep` and `marks`; the endpoint sent neither, and
 * neither is referenced anywhere in the screen's own layout — leftovers from an
 * earlier shape. The whole review/edit feature was unreachable behind them.
 *
 * This test is the contract that a green endpoint suite could never catch: for
 * every screen the endpoint can return, everything the Flow DECLARES must be
 * something the endpoint SENDS.
 */
const fs = require('fs');
const path = require('path');

const FLOW = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../../docs/flows/assessment-gen-flow.json'), 'utf8'));
const ENDPOINT_SRC = fs.readFileSync(
  path.join(__dirname, '../../bot/shared/routes/assessment-gen-endpoint.js'), 'utf8');

const screenById = Object.fromEntries(FLOW.screens.map((s) => [s.id, s]));

describe('every declared data key is one the endpoint can actually send', () => {
  test('KEEP declares nothing the endpoint does not send', () => {
    const declared = Object.keys(screenById.KEEP.data || {});
    // The keys the KEEP payload is built from, in the endpoint's own source.
    const sent = new Set([
      'summary', 'progress', 'questions', 'selected',
      'page', 'has_prev', 'has_next', 'error', 'has_error',
    ]);
    const missing = declared.filter((k) => !sent.has(k));
    expect(missing).toEqual([]);
  });

  test('no screen declares a key that is neither sent nor referenced', () => {
    const offenders = [];
    for (const s of FLOW.screens) {
      const blob = JSON.stringify(s);
      for (const key of Object.keys(s.data || {})) {
        const referenced = blob.includes(`\${data.${key}}`);
        // A key the layout never reads AND the endpoint never names is dead
        // weight that can only break a render.
        const named = new RegExp(`\\b${key.replace(/[^\w]/g, '')}\\b`).test(ENDPOINT_SRC);
        if (!referenced && !named) offenders.push(`${s.id}.${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
