'use strict';
/** bd-v0toag.32 — the register script's payloads: what we would submit to Meta (never called here). */
const { payloads } = require('../../../scripts/register-weekly-usage-templates');

const vars = (s) => [...s.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
const P = payloads();

test('four payloads: two names x en_US + ur, all UTILITY', () => {
  expect(P.map((p) => `${p.name}/${p.language}`).sort()).toEqual([
    'weekly_usage_quiet_v1/en_US', 'weekly_usage_quiet_v1/ur', 'weekly_usage_v1/en_US', 'weekly_usage_v1/ur',
  ]);
  expect(P.every((p) => p.category === 'UTILITY')).toBe(true);
});

test('each has one BODY with an example per variable', () => {
  for (const p of P) {
    expect(p.components).toHaveLength(1);
    const [c] = p.components;
    expect(c.type).toBe('BODY');
    expect(c.example.body_text).toHaveLength(1);
    expect(c.example.body_text[0]).toHaveLength(vars(c.text).length);
  }
});

test('the report has six variables and no thing-to-try line or {{7}}', () => {
  for (const p of P.filter((x) => x.name === 'weekly_usage_v1')) {
    const { text } = p.components[0];
    expect(vars(text)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(text).not.toContain('{{7}}');
    expect(text.toLowerCase()).not.toContain('thing to try');
    expect(text).not.toContain('آزمانے');
  }
});
