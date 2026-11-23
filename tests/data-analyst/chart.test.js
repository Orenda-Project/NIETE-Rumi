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

describe('wide results still get a chart; the other measures are listed, never dropped (bd-bhgw20.4)', () => {
  // The live payload of quick pick 2 on 21 Nov (query_metric hitl_conducted by sector): six sectors, five measures.
  // Their select.py draws at most three series, so this was no chart at all, and the reply named only two sectors.
  const HITL = metricCall({
    rows: [
      { sector: 'B.K', value: 229, reviewed: 217, complete: 212, debrief_pending: 5, awaiting_review: 12 },
      { sector: 'Nilore', value: 131, reviewed: 127, complete: 122, debrief_pending: 5, awaiting_review: 4 },
      { sector: 'Sihala', value: 148, reviewed: 148, complete: 135, debrief_pending: 13, awaiting_review: 0 },
      { sector: 'Tarnol', value: 186, reviewed: 170, complete: 160, debrief_pending: 10, awaiting_review: 16 },
      { sector: 'Urban-I', value: 249, reviewed: 230, complete: 221, debrief_pending: 9, awaiting_review: 19 },
      { sector: 'Urban-II', value: 192, reviewed: 131, complete: 120, debrief_pending: 11, awaiting_review: 61 },
    ],
    measures: [
      { name: 'value', label: 'coach visits where the coach observed the class - scored, and not cancelled, abandoned, failed or a test clean-up' },
      { name: 'reviewed', label: 'visits the coach has reviewed' },
      { name: 'complete', label: 'visits whose debrief has gone to the teacher' },
      { name: 'debrief_pending', label: 'reviewed visits waiting for the debrief' },
      { name: 'awaiting_review', label: "visits waiting for the coach's review" },
    ],
    period: '01 Nov 2026 - 21 Nov 2026',
  }, { metric: 'hitl_conducted', by: ['sector'] });

  test('quick pick 2: the first measure in the metric\'s own order is the chart, one bar per sector', () => {
    const [spec] = C.chartSpecs([HITL], 'How many coach visits were held this month, by sector?');
    expect(spec.kind).toBe('bar_h');
    expect(spec.labels).toEqual(['B.K', 'Nilore', 'Sihala', 'Tarnol', 'Urban-I', 'Urban-II']);
    expect(spec.series).toHaveLength(1);
    expect(spec.series[0][1]).toEqual([229, 131, 148, 186, 249, 192]);
  });
  test('the other four measures come back as one short line per sector', () => {
    const [spec] = C.chartSpecs([HITL], 'How many coach visits were held this month, by sector?');
    expect(spec.rest).toHaveLength(6);
    expect(spec.rest[0]).toBe('B.K: 217 reviewed · 212 complete · 5 debrief pending · 12 awaiting review');
    expect(spec.rest[5]).toBe('Urban-II: 131 reviewed · 120 complete · 11 debrief pending · 61 awaiting review');
  });
  test('measures the question names are the chart (at most three), in the metric\'s order; the rest are listed', () => {
    const [spec] = C.chartSpecs([HITL], 'How many visits were reviewed and how many complete, by sector?');
    expect(spec.kind).toBe('grouped_bar');
    expect(spec.series.map((s) => s[1][0])).toEqual([217, 212]);
    expect(spec.rest[0]).toBe('B.K: 229 coach visits · 5 debrief pending · 12 awaiting review');
  });
  test('every value of every measure is either drawn or listed', () => {
    const [spec] = C.chartSpecs([HITL], 'How many coach visits were held this month, by sector?');
    const rows = JSON.parse(HITL.result).rows;
    for (const [i, row] of rows.entries()) {
      for (const [k, v] of Object.entries(row)) {
        if (k === 'sector' || k === 'value') continue;
        expect(spec.rest[i]).toContain(`${C.fmt(v)} `);
      }
    }
  });
  test('a wide SQL result is treated the same way: first column drawn, the rest listed', () => {
    const rows = ['B.K', 'Nilore', 'Tarnol'].map((s, i) => ({ sector: s, plans: 100 + i, teachers: 50 + i, schools: 10 + i, quizzes: 7 + i }));
    const [spec] = C.chartSpecs([sqlCall(rows)], 'Lesson plans by sector');
    expect(spec.kind).toBe('bar_h');
    expect(spec.series[0][1]).toEqual([100, 101, 102]);
    expect(spec.rest[1]).toBe('Nilore: 51 teachers · 11 schools · 8 quizzes');
  });
  test('more rows than grouped bars allow: one measure drawn, the other listed', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ school: `School ${i + 1}`, visits: 20 + i, reviewed: 10 + i }));
    const [spec] = C.chartSpecs([sqlCall(rows)], 'Visits and reviews by school');
    expect(spec.kind).toBe('bar_h');
    expect(spec.series[0][1][0]).toBe(20);
    expect(spec.rest[0]).toBe('School 1: 10 reviewed');
  });
  test('a narrow result has nothing to list, and the refusals still hold for wide ones', () => {
    expect(C.chartSpecs([BY_SECTOR], 'q')[0].rest).toEqual([]);
    const rows = JSON.parse(HITL.result).rows;
    expect(C.chartSpecs([sqlCall(rows, { truncated: true })], 'q')).toEqual([]);
  });
});

describe('breakdownLines: with no chart, every row of the breakdown is listed by the app, not left to the model (bd-bhgw20.4)', () => {
  test('one measure: "<name>: <n>" for every row, in the result\'s order', () => {
    expect(C.breakdownLines([BY_SECTOR], 'q')).toEqual(['B.K: 389', 'Nilore: 199', 'Sihala: 230', 'Tarnol: 269', 'Urban-I: 451', 'Urban-II: 278']);
  });
  test('several measures: each named, the first under its label\'s name', () => {
    const rows = [{ sector: 'B.K', value: 229, reviewed: 217 }, { sector: 'Nilore', value: 131, reviewed: 127 }];
    const call = metricCall({ rows, measures: [{ name: 'value', label: 'coach visits where the coach observed the class' }, { name: 'reviewed', label: 'visits the coach has reviewed' }] });
    expect(C.breakdownLines([call], 'q')).toEqual(['B.K: 229 coach visits · 217 reviewed', 'Nilore: 131 coach visits · 127 reviewed']);
  });
  test('more rows than a chart takes are still listed, up to 20, then a count of the rest', () => {
    const rows = Array.from({ length: 23 }, (_, i) => ({ school: `School ${i + 1}`, n: i + 1 }));
    const lines = C.breakdownLines([sqlCall(rows)], 'q');
    expect(lines).toHaveLength(21);
    expect(lines[0]).toBe('School 1: 1');
    expect(lines[20]).toBe('… and 3 more');
  });
  test('never people, ids, a single number, or a truncated result', () => {
    expect(C.breakdownLines([sqlCall([{ teacher_name: 'A', n: 1 }, { teacher_name: 'B', n: 2 }])], 'q')).toEqual([]);
    expect(C.breakdownLines([sqlCall([{ school_id: 'x', n: 1 }, { school_id: 'y', n: 2 }])], 'q')).toEqual([]);
    expect(C.breakdownLines([sqlCall([{ teachers: 1816 }])], 'q')).toEqual([]);
    expect(C.breakdownLines([sqlCall([{ sector: 'A', n: 1 }, { sector: 'B', n: 2 }], { truncated: true })], 'q')).toEqual([]);
  });
});
