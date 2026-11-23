'use strict';
/**
 * The prompt is the data team's, not ours: their SYSTEM_PROMPT verbatim at the pinned version, their
 * "today" block computed the same way (golden cases produced by running their code), then one block
 * of what WhatsApp changes.
 */

const crypto = require('crypto');
const P = require('../../bot/shared/services/data-analyst/prompt');
const CONTRACT = require('../../bot/shared/services/data-analyst/vendor/data-mcp-contract.json');
const GOLDEN = require('./fixtures/today-cases.v0.42.5.json');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

test('pinned to the data MCP version that is live (v0.42.5)', () => {
  expect(CONTRACT.source.version).toBe('0.42.5');
  expect(P.CONTRACT_VERSION).toBe('0.42.5');
});

test('the system prompt is their SYSTEM_PROMPT, unchanged', () => {
  expect(P.SYSTEM_PROMPT).toBe(CONTRACT.system_prompt);
  // Their prompt opens with its own role line and carries the rules-first procedure.
  expect(P.SYSTEM_PROMPT.startsWith('You are the Taleemabad data analyst')).toBe(true);
  expect(P.SYSTEM_PROMPT).toContain('Call `get_rules` for the relevant region and domain.');
  expect(sha(P.SYSTEM_PROMPT)).toBe(sha(CONTRACT.system_prompt));
});

describe('today block = theirs, for every golden moment', () => {
  for (const { iso, text } of GOLDEN.cases) {
    test(iso, () => {
      expect(P.todayBlock(new Date(iso)).text).toBe(text);
    });
  }
});

test('last complete week is Saturday to Friday (their rules), never the trailing 7 days', () => {
  expect(P.lastCompleteWeek('2026-09-13')).toEqual(['2026-09-05', '2026-09-11']);
  expect(P.lastCompleteWeek('2026-11-20')).toEqual(['2026-11-07', '2026-11-13']);
  expect(P.lastCompleteWeek('2026-11-21')).toEqual(['2026-11-14', '2026-11-20']);
});

describe('systemBlocks', () => {
  const blocks = P.systemBlocks(new Date('2026-11-20T16:00:00Z'));
  test('their contract (cached), today (uncached), then what WhatsApp changes', () => {
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({ type: 'text', text: CONTRACT.system_prompt, cache_control: { type: 'ephemeral' } });
    expect(blocks[1].cache_control).toBeUndefined();
    expect(blocks[1].text).toContain("## Today's date");
    expect(blocks[2].text).toBe(P.WHATSAPP_PROMPT);
  });
  test('the WhatsApp block: ICT only, WhatsApp formatting, a chart image, no files, asks by tap', () => {
    const w = P.WHATSAPP_PROMPT;
    expect(w).toMatch(/ICT/);
    expect(w).toMatch(/niete-rumi/);
    expect(w).toMatch(/WhatsApp/);
    expect(w).toMatch(/chart image/i);
    expect(w).toMatch(/save_query_results/);
    expect(w).toMatch(/^ASK: /m);
    expect(w).toMatch(/NEXT:/);
  });
  test('ICT is the default, never a reason to skip the rules: only a named other region or country is refused', () => {
    // Live trial 20 Nov: "Are FICO scores improving since September?" was refused in one step, no rules read,
    // because the block said "any other region, country or programme" and FICO read as a programme.
    const w = P.WHATSAPP_PROMPT;
    expect(w).toMatch(/Every question here is about ICT/);
    expect(w).toMatch(/always call `get_rules` for region `niete-rumi` first/);
    expect(w).not.toMatch(/programme, say/);
    expect(w).toMatch(/names another region or country/);
  });
});

test('round 2: the answer is one or two lines beside a chart, with no NEXT line (the buttons replace it)', () => {
  const w = P.WHATSAPP_PROMPT;
  expect(w).toMatch(/one or two short lines/i);
  expect(w).toMatch(/as a chart image/i);
  expect(w).toMatch(/Leave out the `NEXT:` line/);
  expect(w).not.toMatch(/numbered follow-ups/);
});

test('bd-bhgw20.4: the text never relies on a chart: the app shows every row (chart and listed lines, or a list); the model writes the opening lines', () => {
  const w = P.WHATSAPP_PROMPT;
  expect(w).toMatch(/every measure the chart leaves out/i);
  expect(w).toMatch(/a list of every row/i);
  expect(w).toMatch(/one or two short lines/i);
  expect(w).not.toMatch(/no bullets/i);
  expect(w).not.toMatch(/is drawn as a chart image\*\* by the app, under your words/);
});
