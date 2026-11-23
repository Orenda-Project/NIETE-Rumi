import { describe, it, expect } from 'vitest';
import { limitTotal, newPicks, stepWhy, type Picks } from './model';

/**
 * ICT sheet, Assessment Generator row 12 (Saba Kokab; Amena's decision 21 Nov 2026): a group of MCQs, blanks or
 * true/false under one heading counts as ONE question toward the 50; a written question counts one each; at most
 * maxItems print. The grouped types and the ceiling come from the bot's /assessment/options, never from here.
 */
const limits = { grouped: ['MCQs', 'Fill in the Blanks', 'True/False'], maxItems: 100 };
const base = (over: Partial<Picks> = {}): Picks => ({
  ...newPicks(15), grade: 5, subject: 'science', coverBy: 'chapters', chapters: [1], seen: 0, ...over,
});

describe('grouped counting (AG row 12)', () => {
  it('limitTotal: a grouped type is one, a written question one each, a seen number one each', () => {
    expect(limitTotal(base({ typeCounts: { MCQs: 20, 'Fill in the Blanks': 10, 'Short Questions': 12 } }), limits.grouped)).toBe(14);
    expect(limitTotal(base({ seen: 5, typeCounts: { MCQs: 20 } }), limits.grouped)).toBe(6);
    expect(limitTotal(base({ seenTypeCounts: { MCQs: 10 }, typeCounts: { 'True/False': 9 } }), limits.grouped)).toBe(2);
    expect(limitTotal(base({ typeCounts: { MCQs: 0 } }), limits.grouped)).toBe(0);
  });

  it('20 MCQs + 10 blanks + 10 T/F + 25 written (65 items) may go on', () => {
    const p = base({ typeCounts: { MCQs: 20, 'Fill in the Blanks': 10, 'True/False': 10, 'Short Questions': 25 } });
    expect(stepWhy('questions', p, 50, { limits })).toBeNull();
    expect(stepWhy('check', p, 50, { limits })).toBeNull();
  });

  it('51 written questions, or more than 100 items, may not', () => {
    expect(stepWhy('questions', base({ typeCounts: { 'Short Questions': 51 } }), 50, { limits })).toEqual({ code: 'count', max: 50 });
    expect(stepWhy('questions', base({ typeCounts: { MCQs: 50, 'True/False': 50, 'Short Questions': 1 } }), 50, { limits }))
      .toEqual({ code: 'items', max: 100 });
  });

  it('with no limits from the bot it counts every item, as before', () => {
    expect(stepWhy('questions', base({ seen: 45, typeCounts: { MCQs: 10 } }), 50)).toEqual({ code: 'count', max: 50 });
  });
});
