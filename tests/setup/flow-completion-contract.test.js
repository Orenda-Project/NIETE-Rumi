/**
 * How a WhatsApp Flow completes — the two contracts the whatsapp-flows skill (rules 11 and 14)
 * names this file for. It did not exist, which is how the v5 registration Flow shipped a final
 * reply that never closed (bd-x7aprz.9, production 2026-10-19).
 *
 * 1. A terminal screen that DECLARES extension_message_response must declare
 *    properties.params — an example is not a declaration; Meta strips undeclared sub-objects.
 * 2. An endpoint reply that names screen 'SUCCESS' closes the Flow only when it carries
 *    data.extension_message_response (WhatsApp then sends its params as the nfm_reply). A
 *    'SUCCESS' reply without it asks the client to RENDER a screen instead — production's v5
 *    registration reply did exactly that and the client never rendered it, four times. So every
 *    such reply carries extension_message_response, unless its endpoint is listed below as one
 *    that renders a SUCCESS screen ON PURPOSE (the user closes it with its own Done button).
 *    Adding to that list is a decision: prove the screen renders on a real phone first.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const FLOWS = path.join(ROOT, 'docs/flows');
const ROUTES = path.join(ROOT, 'bot/shared/routes');

// Endpoints whose 'SUCCESS' reply renders a screen the user closes herself. Existing as of
// 2026-10-19; not proven live by this guard — see the header before adding one.
const RENDERS_SUCCESS_SCREEN = new Set([
  'attendance-setup-endpoint.js',
  'pakistan-lp-endpoint.js',
  'pic-lp-endpoint.js',
  'student-videos-endpoint.js',
]);

/** The object literal that encloses position `at` in `src` (from its `{` to the matching `}`). */
function enclosingObject(src, at) {
  let depth = 0;
  let start = -1;
  for (let i = at; i >= 0; i -= 1) {
    if (src[i] === '}') depth += 1;
    else if (src[i] === '{') {
      if (depth === 0) { start = i; break; }
      depth -= 1;
    }
  }
  if (start < 0) return '';
  depth = 0;
  for (let j = start; j < src.length; j += 1) {
    if (src[j] === '{') depth += 1;
    else if (src[j] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, j + 1);
    }
  }
  return src.slice(start);
}

describe('flow completion contract', () => {
  it('a terminal screen that declares extension_message_response declares properties.params', () => {
    const bad = [];
    for (const f of fs.readdirSync(FLOWS).filter((x) => x.endsWith('.json'))) {
      const flow = JSON.parse(fs.readFileSync(path.join(FLOWS, f), 'utf8'));
      for (const s of flow.screens || []) {
        const emr = (s.data || {}).extension_message_response;
        if (s.terminal && emr && !('params' in (emr.properties || {}))) bad.push(`${f}::${s.id}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("an endpoint reply that names screen 'SUCCESS' closes the Flow (carries extension_message_response)", () => {
    const bad = [];
    for (const f of fs.readdirSync(ROUTES).filter((x) => x.endsWith('.js'))) {
      if (RENDERS_SUCCESS_SCREEN.has(f)) continue;
      const src = fs.readFileSync(path.join(ROUTES, f), 'utf8');
      for (const m of src.matchAll(/screen:\s*['"]SUCCESS['"]/g)) {
        if (!enclosingObject(src, m.index).includes('extension_message_response')) {
          bad.push(`${f}:${src.slice(0, m.index).split('\n').length}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('every allowlisted endpoint present on this branch still returns SUCCESS (else drop it)', () => {
    // Branches diverge (pic-lp-endpoint.js is on main, not on sandbox), so an absent file is skipped;
    // a present one that no longer names SUCCESS is a stale entry and fails.
    for (const f of RENDERS_SUCCESS_SCREEN) {
      const p = path.join(ROUTES, f);
      if (!fs.existsSync(p)) continue;
      expect(fs.readFileSync(p, 'utf8')).toMatch(/screen:\s*['"]SUCCESS['"]/);
    }
  });
});
