'use strict';
const H = require('../../../bot/shared/services/assessment/board-render/header');
const fx = require('./_fixtures');

const count = (html, cls) => (html.match(new RegExp(`class="${cls}"`, 'g')) || []).length;

describe('board-render/header', () => {
  test('prints the chrome exam-header lines with atoms filled', () => {
    const html = H.headerBlock(fx.fbise50()._layout, 'en');
    expect(html).toContain('Federal Board SSC-I Examination');
    expect(html).toContain('Physics · Examination Paper');
    expect(html).toContain('(50% MCQs &amp; 50% Descriptive)');
    expect(html).toContain('Time Allowed: 3 hrs · Total Marks: 60');
    expect(html).not.toContain('{t:');
  });
  test('Urdu header lines come from the _ur chrome', () => {
    const html = H.headerBlock(fx.urdu()._layout, 'ur');
    expect(html).toContain('وفاقی بورڈ');
    expect(html).toContain('امتحانی پرچہ');
  });
  test('no header in the layout prints an empty header block, never invented lines', () => {
    const L = fx.fbise50()._layout;
    L.header = null;
    expect(H.headerBlock(L, 'en')).not.toMatch(/Federal|Marks/);
  });
  test('roll-number (6 × 10) and version (4) bubbles when a section answers on the question paper', () => {
    const html = H.bubbleBlock(fx.fbise50()._layout, 'en');
    expect(count(html, 'bub')).toBe(64);
    expect(html).toContain('Roll No');
  });
  test('no bubble block when no section answers on the question paper', () => {
    const L = fx.fbise50()._layout;
    L.sections.forEach((s) => { s.answer_on = 'omr'; });
    expect(H.bubbleBlock(L, 'en')).toBe('');
  });
  test('omr and e_sheet sections get an answer note; question_paper gets none', () => {
    expect(H.noteFor({ answer_on: 'omr' }, 'en')).toMatch(/OMR/);
    expect(H.noteFor({ answer_on: 'e_sheet' }, 'en')).toMatch(/answer sheet/i);
    expect(H.noteFor({ answer_on: 'question_paper' }, 'en')).toBe('');
    expect(H.noteFor({ answer_on: 'omr', note_en: 'Own note.' }, 'en')).toBe('Own note.');
  });
});
