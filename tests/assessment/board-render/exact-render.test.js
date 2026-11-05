'use strict';
// Exact-output pins for items.js / scheme-items.js on hand-built fictional layouts (see _exact.fixture.js).
const I = require('../../../bot/shared/services/assessment/board-render/items');
const S = require('../../../bot/shared/services/assessment/board-render/scheme-items');
const F = require('./_exact.fixture');
const G = require('./_exact.golden');

const ctx = (rtl) => ({ rtl, lang: rtl ? 'ur' : 'en' });
const gold = (k) => G[k].join('');

describe('items.sectionBlock exact output', () => {
  test.each([['qp', false], ['qp', true], ['omr', false], ['omr', true]])('%s rtl=%s', (k, rtl) => {
    const html = I.sectionBlock(F.pLayout, F.pSecs[k], F.pBy, ctx(rtl));
    expect(html).toBe(gold(`paper_${k}_${rtl ? 'ur' : 'en'}`));
  });
  test('a slot with one attempt prints just its total; with project marks_each comes from the project', () => {
    expect(I.marksLine({ attempt: 1, marks: 6, marks_each: 6 })).toBe('({t:6})');
    expect(I.marksLine({ attempt: 3, marks: 6, marks_each: 2 })).toBe('({n:3} × 2 = {t:6})');
    expect(I.marksLine({ attempt: 2, marks: 7, marks_each: 1, project: { marks: 3.5 } })).toBe('({n:2} × 3.5 = {t:7})');
  });
  test('Urdu OR word and English OR word', () => {
    expect(I.orWord(false)).toBe('OR');
    expect(I.orWord(true)).toBe('یا');
  });
  test('the second part opens only once the first part marks are reached (fractional marks)', () => {
    const slots = [1, 2, 3].map((n) => ({ slot: `B.${n}`, section: 'B', type: 'srq', label: `L${n}`, marks: 0.75, marks_each: 0.75, attempt: 1, printed: 1 }));
    const sec = { id: 'B', marks: 2.25, answer_on: 'omr', parts: [{ part: 'X', marks: 1.5, handover_note_en: 'H-X' }, { part: 'Y', marks: 0.75, handover_note_en: 'H-Y' }] };
    const html = I.sectionBlock({ slots, sections: [sec] }, sec, new Map(), ctx(false));
    const at = (s) => html.indexOf(s);
    expect(at('Part X')).toBeLessThan(at('L1'));
    expect(at('L2')).toBeLessThan(at('H-X'));
    expect(at('H-X')).toBeLessThan(at('Part Y'));
    expect(at('Part Y')).toBeLessThan(at('L3'));
    expect(at('L3')).toBeLessThan(at('H-Y'));
    expect(html.match(/class="part-head"/g)).toHaveLength(2);
  });
  test('part head with its own time prints it; a stimulus change reprints the stimulus', () => {
    const slot = { slot: 'C.1', section: 'C', type: 'mcq', label: 'M', marks: 1, marks_each: 0.5, attempt: 2, printed: 2 };
    const a = { id: 1, text: 'one' };
    const b = { id: 2, text: 'two' };
    const by = new Map([['C.1', [{ question: 'q', stimulus: a }, { question: 'q', stimulus: b }, { question: 'q' }]]]);
    const sec = { id: 'C', marks: 1, answer_on: 'omr' };
    const html = I.sectionBlock({ slots: [slot], sections: [sec] }, sec, by, ctx(false));
    expect(html.match(/class="stim"/g)).toHaveLength(2);
  });
  test('an MCQ slot without options still prints its row; no or-line for a single-item OR slot', () => {
    const slot = { slot: 'C.1', section: 'C', type: 'mcq', label: 'M', marks: 1, marks_each: 1, attempt: 1, printed: 1, or: { branches: [1] } };
    const sec = { id: 'C', marks: 1, answer_on: 'question_paper' };
    const html = I.sectionBlock({ slots: [slot], sections: [sec] }, sec, new Map([['C.1', [{ question: 'q' }]]]), ctx(false));
    expect(html).toContain('<div class="opts"></div>');
    expect(html).not.toContain('class="or"');
    expect(html).not.toContain('class="note"');
  });
  test('answer_on question_paper does not give a bubble to a non-MCQ slot', () => {
    const slot = { slot: 'C.1', section: 'C', type: 'srq', label: 'S', marks: 1, marks_each: 1, attempt: 1, printed: 1 };
    const sec = { id: 'C', marks: 1, answer_on: 'question_paper' };
    const html = I.sectionBlock({ slots: [slot], sections: [sec] }, sec, new Map([['C.1', [{ question: 'q' }]]]), ctx(false));
    expect(html).not.toContain('bub');
  });
  test('time_min of 0 still prints a time; a missing time prints none', () => {
    const sec = { id: 'C', marks: 1, time_min: 0, answer_on: 'omr' };
    expect(I.sectionBlock({ slots: [], sections: [sec] }, sec, new Map(), ctx(false))).toContain('<span>0 min</span>');
    const none = { id: 'C', marks: 1, answer_on: 'omr' };
    expect(I.sectionBlock({ slots: [], sections: [none] }, none, new Map(), ctx(false))).not.toContain('min');
  });
});

describe('scheme-items exact output', () => {
  test.each([[false], [true]])('schemeSection rtl=%s', (rtl) => {
    const html = S.schemeSection(F.sLayout, F.sLayout.sections[0], F.sBy, ctx(rtl));
    expect(html).toBe(gold(`scheme_${rtl ? 'ur' : 'en'}`));
  });
  test.each([[false], [true]])('classRecord rtl=%s', (rtl) => {
    expect(S.classRecord(F.sLayout, ctx(rtl), 2)).toBe(gold(`record_${rtl ? 'ur' : 'en'}`));
  });
  test('classRecord defaults to ten blank rows', () => {
    expect(S.classRecord(F.sLayout, ctx(false)).match(/class="rec-row"/g)).toHaveLength(10);
  });
  test('a tag with neither bloom nor SLO prints no meta line; empty criteria prints no criteria block', () => {
    const slot = { slot: 'D.1', section: 'D', label: 'T', marks: 1, marks_each: 1, attempt: 1, printed: 1, teacher_marked: true, project: { marks: 1, criteria_en: [] } };
    const lay = { slots: [slot], sections: [{ id: 'D', marks: 1 }] };
    expect(S.schemeSection(lay, lay.sections[0], new Map(), ctx(false))).not.toContain('Criteria');
    const s2 = { slot: 'D.2', section: 'D', type: 'srq', label: 'T', marks: 1, marks_each: 1, attempt: 1, printed: 1 };
    const lay2 = { slots: [s2], sections: [{ id: 'D', marks: 1 }] };
    const by = new Map([['D.2', [{ question: 'q', tag: { chapter: 3 } }]]]);
    expect(S.schemeSection(lay2, lay2.sections[0], by, ctx(false))).not.toContain('meta');
  });
});
