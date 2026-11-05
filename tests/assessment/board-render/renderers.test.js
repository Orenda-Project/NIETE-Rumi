'use strict';
const { renderBoardPaper } = require('../../../bot/shared/services/assessment/assessment-paper-board.renderer');
const { renderBoardScheme } = require('../../../bot/shared/services/assessment/assessment-scheme-board.renderer');
const fx = require('./_fixtures');

const n = (html, s) => html.split(s).length - 1;
const totals = (html, attr) => [...html.matchAll(new RegExp(`${attr}="([0-9.]+)"`, 'g'))].reduce((s, m) => s + Number(m[1]), 0);
const total = (L) => L.sections.reduce((s, x) => s + x.marks, 0);
const CASES =[['fbise50'], ['fbiseNon'], ['urdu']];

describe('board paper (child html)', () => {
  test.each(CASES)('%s: chrome lines, no page placeholder, no tag/key leak', (name) => {
    const exam = fx[name]();
    const html = renderBoardPaper(exam);
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).not.toMatch(/\{n\}|\{N\}/); // the PDF footer numbers the pages (board-render/print.js)
    expect(html).not.toMatch(/SECRET|official_slo|S-09-|LO-\d|"tag"|difficulty/);
    expect(html).not.toContain('{t:');
  });
  test('FBISE 50%: header, bubbles for roll + version + 60 MCQs, stimulus once each, fractional marks', () => {
    const html = renderBoardPaper(fx.fbise50());
    expect(html).toContain('Federal Board SSC-I Examination');
    expect(html).toContain('(50% MCQs &amp; 50% Descriptive)');
    expect(n(html, 'class="bub"')).toBe(64 + 240);
    expect(n(html, 'class="stim"')).toBe(5);
    expect(html).toContain('(40 × ½ = 20)');
    expect(html).toContain('dir="ltr"');
  });
  test('FBISE non-50%: OR, attempt-any, teacher slot, handover', () => {
    const html = renderBoardPaper(fx.fbiseNon());
    expect(n(html, 'class="or"')).toBe(1);
    expect(html).toContain('Attempt any 3 questions.');
    expect(html).toContain('class="teacher-slot"');
    expect(html).toContain('Hand in Part D1 now.');
    expect(html).toContain('Time Allowed: 3 hrs');
  });
  test('Urdu: dir=rtl, Urdu digits, Urdu chrome', () => {
    const html = renderBoardPaper(fx.urdu());
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="ur"');
    expect(html).toContain('وفاقی بورڈ');
    expect(html).toContain('۷۵');
    expect(html).not.toMatch(/Total Marks/);
  });
  test('throws on a paper with no board layout', () => {
    expect(() => renderBoardPaper({})).toThrow(/NO_LAYOUT/);
  });
});

describe('board marking scheme', () => {
  test.each(CASES)('%s: scheme slot totals add up to _layout total', (name) => {
    const exam = fx[name]();
    const html = renderBoardScheme(exam);
    expect(totals(html, 'data-slot-total')).toBe(total(exam._layout));
    expect(totals(html, 'data-section-total')).toBe(total(exam._layout));
    expect(html).toContain('class="legend"');
    expect(html).toContain('class="rec-row"');
  });
  test('analytic scheme for FBISE, holistic bands for Urdu fixture', () => {
    expect(renderBoardScheme(fx.fbiseNon())).toContain('class="points"');
    expect(renderBoardScheme(fx.urdu())).toContain('class="bands"');
  });
  test('scheme carries keys and blooms/SLO; paper does not', () => {
    const exam = fx.fbiseNon();
    expect(renderBoardScheme(exam)).toContain('S-09-0');
    expect(renderBoardPaper(exam)).not.toContain('S-09-0');
  });
});
