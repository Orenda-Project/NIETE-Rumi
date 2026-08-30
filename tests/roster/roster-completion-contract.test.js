/**
 * The /roster completion ack: what the Flow sends must be what the bot reads.
 *
 * FIELD EVIDENCE (2026-08-30). A coach saved a 16-student roster successfully and
 * got the catch-all "thanks" reply. Staging logged
 * `📋 Processing flow submission { flowType: "unknown" }` — the roster branch of
 * flow-type-detector was never reached, because `responseJson.roster_action` was
 * undefined. The SAVED screen was passing its discriminators inside an
 * `extension_message_response` object whose `properties` were declared `{}`, so
 * nothing arrived at the top level of the response.
 *
 * The shape this deployment PROVES works is the flat one: observe-visit-v2,
 * remark, training-msq and exam-checker-confirm-students all put their
 * discriminators straight into the `complete` payload, and their acks fire. So
 * that is what /roster uses, and this file pins the three ends together — the
 * Flow JSON's payload, the screen's `data` declaration, and the keys the bot
 * actually reads off the reply.
 */

const fs = require('fs');
const path = require('path');
const { detectFlowType } = require('../../bot/shared/utils/flow-type-detector');

const ROOT = path.resolve(__dirname, '../..');
const flow = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/flows/roster-flow-v1.json'), 'utf8'));
const botSrc = fs.readFileSync(path.join(ROOT, 'bot/whatsapp-bot.js'), 'utf8');

const terminal = flow.screens.find((s) => s.terminal);

/** The payload of the `complete` action on a screen, wherever it is nested. */
function completePayload(node) {
  if (Array.isArray(node)) {
    for (const n of node) { const hit = completePayload(n); if (hit) return hit; }
    return null;
  }
  if (node && typeof node === 'object') {
    const a = node['on-click-action'];
    if (a && a.name === 'complete') return a.payload || {};
    for (const v of Object.values(node)) { const hit = completePayload(v); if (hit) return hit; }
  }
  return null;
}

/** The body of the bot's `flowType === 'roster'` branch. */
function rosterAckBranch() {
  const start = botSrc.indexOf("flowType === 'roster'");
  expect(start).toBeGreaterThan(-1);
  const rest = botSrc.slice(start);
  const next = rest.indexOf('} else if (flowType ===', 1);
  return next === -1 ? rest.slice(0, 2000) : rest.slice(0, next);
}

describe('/roster completion ack', () => {
  it('the terminal screen sends its discriminators at the TOP LEVEL of the complete payload', () => {
    const payload = completePayload(terminal.layout);
    expect(payload).not.toBeNull();
    // Not nested inside extension_message_response — that is the shape that failed.
    expect(Object.keys(payload)).not.toContain('extension_message_response');
    expect(Object.keys(payload)).toEqual(
      expect.arrayContaining(['roster_action', 'roster_class', 'roster_count']),
    );
  });

  it('every ${data.x} the payload sends is declared in the screen data', () => {
    const payload = completePayload(terminal.layout);
    const declared = Object.keys(terminal.data || {});
    const missing = Object.values(payload)
      .map((v) => (typeof v === 'string' ? (v.match(/^\$\{data\.(\w+)\}$/) || [])[1] : null))
      .filter(Boolean)
      .filter((k) => !declared.includes(k));
    expect(missing).toEqual([]);
  });

  it('every key the bot reads off the reply is one the payload actually sends', () => {
    const payload = Object.keys(completePayload(terminal.layout));
    const read = [...new Set(
      [...rosterAckBranch().matchAll(/responseJson\.(\w+)/g)].map((m) => m[1]),
    )];
    expect(read.length).toBeGreaterThan(0);
    expect(read.filter((k) => !payload.includes(k))).toEqual([]);
  });

  it('the detector routes a roster reply to the roster branch', () => {
    expect(detectFlowType({ roster_action: 'saved', roster_class: 'Grade 3-A', roster_count: '16' }))
      .toBe('roster');
  });

  it('a reply with no roster_action is NOT claimed by the roster branch', () => {
    expect(detectFlowType({ some_other_action: 'x' })).not.toBe('roster');
  });
});
