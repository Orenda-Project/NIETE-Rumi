'use strict';
/**
 * lp_splits.json entries (bd-zrdvmi.1.2, queue #67: one book topic per day).
 *
 * A plain string splits a lesson into two parts that repeat the original topic and pages (the
 * 2 Oct over-long-lesson splits). An object entry { id, parts: [{ topic, pages }, { topic, pages }] }
 * gives each part its OWN topic and pages, so a day that taught two book topics shows one topic
 * per teaching day in the list.
 */
const B = require('../../scripts/build-lp-catalog');
const { applySplits, splitId } = require('../../scripts/lp-catalog-splits');

const lesson = (seg) => ({
  lesson_id: `grade_4_english_ch12_seg${seg}`,
  segment_index: seg,
  lp_type: 'content',
  section: 'Grammar Playground',
  topic: 'Grammar: Adverb Match Up + Future Tense',
  pages: [145, 146],
});
const catalog = () => ({
  counts: { lessons: 2 },
  books: [{ stem: 'grade_4_english', rtl: false, chapters: [{ number: 12, lessons: [lesson(5), lesson(6)] }] }],
});
const lessonsOf = (c) => c.books[0].chapters[0].lessons;

describe('lp_splits entries', () => {
  test('a plain id still splits into two parts that keep the original topic', () => {
    const out = lessonsOf(applySplits(catalog(), ['grade_4_english_ch12_seg5'], B));
    expect(out.map((l) => l.lesson_id)).toEqual(
      ['grade_4_english_ch12_seg5', 'grade_4_english_ch12_seg5b', 'grade_4_english_ch12_seg6']);
    expect(out[0].topic).toBe('Grammar: Adverb Match Up + Future Tense');
    expect(out[1].topic).toBe('Grammar: Adverb Match Up + Future Tense');
  });

  test('an object entry gives each part its own topic and pages', () => {
    const entry = {
      id: 'grade_4_english_ch12_seg5',
      parts: [{ topic: 'Grammar: Adverbs', pages: [145] }, { topic: 'Grammar: Future Tense', pages: [146] }],
    };
    const out = applySplits(catalog(), [entry], B);
    const [a, b] = lessonsOf(out);
    expect([a.lesson_id, a.part, a.topic, a.pages]).toEqual(['grade_4_english_ch12_seg5', 1, 'Grammar: Adverbs', [145]]);
    expect([b.lesson_id, b.part, b.topic, b.pages]).toEqual(['grade_4_english_ch12_seg5b', 2, 'Grammar: Future Tense', [146]]);
    expect(a.row.metadata).toContain('Adverbs');
    expect(a.row.metadata).not.toContain('Future');
    expect(b.row.metadata).toContain('Future Tense');
    expect(`${b.row.description} ${b.row.metadata}`).toContain('p.146');
    expect(out.counts.lessons).toBe(3);
  });

  test('applying an object entry twice changes nothing', () => {
    const entry = { id: 'grade_4_english_ch12_seg5', parts: [{ topic: 'A', pages: [145] }, { topic: 'B', pages: [146] }] };
    const once = applySplits(catalog(), [entry], B);
    expect(applySplits(once, [entry], B)).toEqual(once);
  });

  test('splitId reads both entry shapes', () => {
    expect(splitId('x_seg1')).toBe('x_seg1');
    expect(splitId({ id: 'x_seg2', parts: [] })).toBe('x_seg2');
  });

  test('an object entry needs exactly two parts, each with a topic', () => {
    const bad = { id: 'grade_4_english_ch12_seg5', parts: [{ topic: 'only one', pages: [145] }] };
    expect(() => applySplits(catalog(), [bad], B)).toThrow(/two parts/);
  });
});
