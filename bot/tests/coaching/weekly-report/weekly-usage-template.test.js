'use strict';
/**
 * bd-v0toag.32 — the two UTILITY templates of the weekly usage report. One definition, read by the sender
 * and by whoever submits them to Meta, so the approved body and the parameters we fill cannot drift.
 */

const T = require('../../../shared/templates/weekly-usage.template');

const vars = (body) => [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
const codePoints = (s) => [...s].length;

describe.each([
  ['the report', T.TEMPLATE, 6],
  ['the quiet week', T.QUIET_TEMPLATE, 2],
])('%s template', (_, tpl, n) => {
  test('has a versioned name and en_US + ur bodies only', () => {
    expect(tpl.name).toMatch(/_v\d+$/);
    expect(Object.keys(tpl.bodies).sort()).toEqual(['en_US', 'ur']);
  });

  test.each(['en_US', 'ur'])('%s: variables {{1}}..{{n}} in order, each once', (code) => {
    expect(vars(tpl.bodies[code])).toEqual(Array.from({ length: n }, (__, i) => i + 1));
  });

  test.each(['en_US', 'ur'])('%s: within Meta rules — ≤1024 code points, no variable at either end', (code) => {
    const body = tpl.bodies[code];
    expect(codePoints(body)).toBeLessThanOrEqual(1024);
    expect(body.trim()).not.toMatch(/^\{\{\d+\}\}/);
    expect(body.trim()).not.toMatch(/\{\{\d+\}\}$/);
  });

  test.each(['en_US', 'ur'])('%s: an example value for every variable', (code) => {
    expect(tpl.examples[code]).toHaveLength(n);
  });

  test('no promotional wording (a UTILITY template that sells is re-categorised MARKETING)', () => {
    const en = tpl.bodies.en_US.toLowerCase();
    for (const w of ['offer', 'free', 'discount', 'buy', 'upgrade', 'limited time', 'don\'t miss', 'new feature']) {
      expect(en).not.toContain(w);
    }
  });
});

test('the two names differ, and the quiet body carries no counts', () => {
  expect(T.TEMPLATE.name).toBe('weekly_usage_v1');
  expect(T.QUIET_TEMPLATE.name).toBe('weekly_usage_quiet_v1');
  expect(T.QUIET_TEMPLATE.bodies.en_US.replace(/\{\{\d+\}\}/g, '')).not.toMatch(/\d/);
});

test('group B report carries no thing-to-try line (Amena, 16 Oct): no {{7}}, no "thing to try" wording, 6 examples', () => {
  for (const code of ['en_US', 'ur']) {
    expect(T.TEMPLATE.bodies[code]).not.toContain('{{7}}');
    expect(T.TEMPLATE.examples[code]).toHaveLength(6);
  }
  expect(T.TEMPLATE.bodies.en_US.toLowerCase()).not.toContain('thing to try');
  expect(T.TEMPLATE.bodies.ur).not.toContain('آزمانے');
  expect(T.TEMPLATE.bodies.en_US).toContain('Reports you agreed with: {{6}}');
});

test('NAMES lists both, for the approval check', () => {
  expect(T.NAMES).toEqual(['weekly_usage_v1', 'weekly_usage_quiet_v1']);
});
