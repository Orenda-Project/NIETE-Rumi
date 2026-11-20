'use strict';
/**
 * Answers with numbers come as a chart image (the operator, 21 Nov). Which result becomes the chart
 * is the data team's own rule set (charting/select.py, ported); the drawing is their Data Studio's
 * SVG (studio/svg.py: a trend is a line with halftone dots, a breakdown is track bars ending in a
 * station), ported; the card is rendered to PNG by the bot's own htmlToImage.
 */

const C = require('../../bot/shared/services/data-analyst/chart');

const metricCall = (payload, args = {}) => ({ name: 'query_metric', arguments: args, result: JSON.stringify({ status: 'ok', ...payload }) });
const sqlCall = (rows, extra = {}) => ({ name: 'execute_query', arguments: { sql: 'SELECT 1' }, result: JSON.stringify({ status: 'ok', rows, total_rows: rows.length, ...extra }) });

const BY_SECTOR = metricCall({
  rows: [
    { sector: 'B.K', value: 389 }, { sector: 'Nilore', value: 199 }, { sector: 'Sihala', value: 230 },
    { sector: 'Tarnol', value: 269 }, { sector: 'Urban-I', value: 451 }, { sector: 'Urban-II', value: 278 },
  ],
  measures: [{ name: 'value', label: 'Teachers who got a lesson plan' }],
  period: '07 Nov 2026 - 13 Nov 2026',
}, { metric: 'lp_users', by: ['sector'] });

const TREND = sqlCall([
  { month: '2026-09', dc_pct: 62.4, coach_pct: 63.7 },
  { month: '2026-10', dc_pct: 64.5, coach_pct: 66.3 },
  { month: '2026-11', dc_pct: 64.2, coach_pct: 65.7 },
]);

describe('selectChart (their select.py rules)', () => {
  test('a categorical breakdown with one measure is a horizontal bar chart, measures named by their label', () => {
    const [spec] = C.chartSpecs([BY_SECTOR], 'How many teachers made a lesson plan last week?');
    expect(spec.kind).toBe('bar_h');
    expect(spec.labels).toEqual(['B.K', 'Nilore', 'Sihala', 'Tarnol', 'Urban-I', 'Urban-II']);
    expect(spec.series).toEqual([['Teachers who got a lesson plan', [389, 199, 230, 269, 451, 278]]]);
    expect(spec.subtitle).toMatch(/07 Nov 2026 - 13 Nov 2026/);
  });
  test('a date label with three or more points is a trend, and a trend outranks a breakdown', () => {
    const specs = C.chartSpecs([BY_SECTOR, TREND], 'Are FICO scores improving since September?');
    expect(specs[0].kind).toBe('trend');
    expect(specs[0].series.map((s) => s[0])).toEqual(['DC %', 'Coach %']);
  });
  test('a single number, a truncated or capped result, a person or id column, or a ragged table is not charted', () => {
    expect(C.chartSpecs([sqlCall([{ teachers: 1816 }])], 'q')).toEqual([]);
    expect(C.chartSpecs([sqlCall([{ sector: 'A', n: 1 }, { sector: 'B', n: 2 }], { truncated: true })], 'q')).toEqual([]);
    expect(C.chartSpecs([sqlCall([{ sector: 'A', n: 1 }, { sector: 'B', n: 2 }], { sql_limit: 100 })], 'q')).toEqual([]);
    expect(C.chartSpecs([sqlCall([{ teacher_name: 'A', n: 1 }, { teacher_name: 'B', n: 2 }])], 'q')).toEqual([]);
    expect(C.chartSpecs([sqlCall([{ school_id: 'x', n: 1 }, { school_id: 'y', n: 2 }])], 'q')).toEqual([]);
    expect(C.chartSpecs([sqlCall([{ sector: 'A', n: 1 }, { sector: 'B' }])], 'q')).toEqual([]);
  });
  test('a total row that is the sum of the others is dropped (their production fix)', () => {
    const [spec] = C.chartSpecs([sqlCall([{ path: 'Menu', plans: 11644 }, { path: 'Typed', plans: 2368 }, { path: 'All', plans: 14012 }])], 'q');
    expect(spec.labels).toEqual(['Menu', 'Typed']);
  });
  test('more than 12 bars is not a chart', () => {
    const rows = Array.from({ length: 13 }, (_, i) => ({ school: `S${i}`, n: i + 1 }));
    expect(C.chartSpecs([sqlCall(rows)], 'q')).toEqual([]);
  });
  test('never throws on garbage', () => {
    expect(C.chartSpecs([{ name: 'execute_query', result: 'not json' }, null, {}], 'q')).toEqual([]);
  });
});

describe('chartSvg (their Data Studio drawing)', () => {
  test('bars: one track bar per row, the value printed at the end, labels escaped', () => {
    const spec = { kind: 'bar_h', title: 'T', labels: ['B.K', 'A & <B>'], series: [['n', [389, 199]]] };
    const svg = C.chartSvg(spec);
    expect(svg.startsWith('<svg')).toBe(true);
    expect((svg.match(/<rect class="bar"/g) || []).length).toBe(2);
    expect(svg).toContain('>389<');
    expect(svg).toContain('A &amp; &lt;B&gt;');
    expect(svg).not.toContain('<B>');
  });
  test('trend: a polyline per series and the axis reads months as people say them', () => {
    const spec = { kind: 'trend', title: 'T', labels: ['2026-09-01', '2026-10-01', '2026-11-01'], series: [['a', [1, 2, 3]], ['b', [2, 2, 2]]] };
    const svg = C.chartSvg(spec);
    expect((svg.match(/<polyline/g) || []).length).toBe(2);
    expect(svg).toContain('>1 Sep<');
  });
  test('a score that moves a few points is drawn zoomed to its spread, not flattened from zero', () => {
    const [lo, hi] = C.trendRange([62.4, 64.5, 64.1, 63.7, 63.5, 66.3]);
    expect(lo).toBeGreaterThan(55);
    expect(lo).toBeLessThan(62.4);
    expect(hi).toBeGreaterThan(66.3);
    expect(C.trendRange([120, 900, 40])).toEqual([0, 900]);
    expect(C.trendRange([-2, 5, 7])).toEqual([0, 7]);
  });
  test('trend: the other line\'s last value is printed too, under its point when it is the lower one', () => {
    const svg = C.chartSvg({ kind: 'trend', title: 'T', labels: ['2026-09', '2026-10', '2026-11'], series: [['DC', [62.4, 64.5, 64.1]], ['HITL', [63.7, 63.5, 66.3]]] });
    expect(svg).toContain('>66.3<');
    expect(svg).toContain('>64.1<');
  });
  test('numbers as their Studio prints them', () => {
    expect(C.fmt(3917)).toBe('3,917');
    expect(C.fmt(63.71)).toBe('63.7');
    expect(C.fmt(0.4212)).toBe('0.42');
  });
});

describe('renderChartPng', () => {
  test('wraps the SVG in a card with its title and footer and renders it with the given renderer', async () => {
    let html = '';
    const png = await C.renderChartPng(C.chartSpecs([BY_SECTOR], 'q')[0], {
      footer: 'NIETE data · 7–13 Nov 2026 · rules v0.42.5',
      render: async (h) => { html = h; return Buffer.from('PNG'); },
    });
    expect(png.toString()).toBe('PNG');
    expect(html).toContain('class="card"');
    expect(html).toContain('<svg');
    expect(html).toContain('NIETE data · 7–13 Nov 2026 · rules v0.42.5');
    expect(html).toContain('Teachers who got a lesson plan');
  });
  test('a renderer failure is no chart, never a throw', async () => {
    const png = await C.renderChartPng(C.chartSpecs([BY_SECTOR], 'q')[0], { render: async () => { throw new Error('no chromium'); } });
    expect(png).toBeNull();
  });
});

describe('long-format trends (FICO by month and coaching kind, as the model writes it)', () => {
  const rows = [
    { month: '2026-09', kind: 'DC', fico_pct: 62.4, observations: 15597 },
    { month: '2026-09', kind: 'HITL', fico_pct: 63.7, observations: 2366 },
    { month: '2026-10', kind: 'DC', fico_pct: 64.5, observations: 7671 },
    { month: '2026-10', kind: 'HITL', fico_pct: 63.5, observations: 1241 },
    { month: '2026-11', kind: 'DC', fico_pct: 64.1, observations: 2000 },
    { month: '2026-11', kind: 'HITL', fico_pct: 66.3, observations: 726 },
  ];
  test('a date, a kind and a score: one line per kind, the count column left out', () => {
    const [spec] = C.chartSpecs([sqlCall(rows)], 'How are FICO scores moving month by month since September?');
    expect(spec.kind).toBe('trend');
    expect(spec.labels).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(spec.series).toEqual([['DC', [62.4, 64.5, 64.1]], ['HITL', [63.7, 63.5, 66.3]]]);
  });
  test('a hole in the grid, more than three kinds, or no score-like measure among several: no chart', () => {
    expect(C.chartSpecs([sqlCall(rows.slice(0, 5))], 'q')).toEqual([]);
    const many = ['A', 'B', 'C', 'D'].flatMap((k) => ['2026-09', '2026-10', '2026-11'].map((m) => ({ month: m, kind: k, fico_pct: 1 })));
    expect(C.chartSpecs([sqlCall(many)], 'q')).toEqual([]);
    const noScore = rows.map((r) => ({ month: r.month, kind: r.kind, visits: r.observations, teachers: 3 }));
    expect(C.chartSpecs([sqlCall(noScore)], 'q')).toEqual([]);
  });
});
