import { describe, it, expect } from 'vitest';
import { bloomOf, editSummary } from './editSummary';

describe('bloomOf (ICT sheet AG rows 6-7)', () => {
  it("reads the bot's tag in any case and either spelling of Analyse", () => {
    expect(bloomOf('apply')).toBe('Apply');
    expect(bloomOf(' Remember ')).toBe('Remember');
    expect(bloomOf('Analyse')).toBe('Analyze');
  });
  it('is null for no tag or an unknown one', () => {
    expect(bloomOf(undefined)).toBeNull();
    expect(bloomOf('')).toBeNull();
    expect(bloomOf('Memorise')).toBeNull();
  });
});

describe('editSummary', () => {
  const rows = [
    { type: 'MCQs', blooms: 'Remember' },
    { type: 'MCQs', blooms: 'Apply' },
    { type: 'MCQs', blooms: 'remember' },
    { type: 'Short Questions', blooms: 'Understand' },
    { type: 'Short Questions' },
  ];

  it("gives each Bloom's level its share of the questions, in Bloom's order, untagged last", () => {
    expect(editSummary(rows).levels).toEqual([
      { level: 'Remember', count: 2, pct: 40 },
      { level: 'Understand', count: 1, pct: 20 },
      { level: 'Apply', count: 1, pct: 20 },
      { level: null, count: 1, pct: 20 },
    ]);
  });

  it('counts question types in the order they first appear', () => {
    expect(editSummary(rows).types).toEqual([{ type: 'MCQs', count: 3 }, { type: 'Short Questions', count: 2 }]);
  });

  it('is empty for no questions, and says nothing about levels when no question has one', () => {
    expect(editSummary([])).toEqual({ levels: [], types: [] });
    expect(editSummary([{ type: 'MCQs' }]).levels).toEqual([]);
  });
});
